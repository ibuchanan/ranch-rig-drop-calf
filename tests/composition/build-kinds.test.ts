import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import {
  reconcileTypeScriptConfig,
  TYPESCRIPT_CONFIGS,
} from "../../src/capabilities/typescript.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { typescriptTemplates } from "../support/templates-source.ts";

function config(text: string | undefined) {
  const result = ts.parseConfigFileTextToJson("tsconfig.json", text ?? "");
  expect(result.error).toBeUndefined();
  return result.config;
}

/**
 * Every kind carries no tsconfig in the blueprint: they are all seeded verbatim
 * from `templates/typescript`, so read the generated output the way a user
 * would.
 */
function seededConfigs() {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"])
    expect(
      buildProject(kind, "sample", "tester").files.has("tsconfig.json"),
    ).toBe(false);
  return typescriptTemplates();
}

test("every kind seeds the TypeScript configs its scripts invoke", () => {
  const project = buildProject("forge-app", "sample", "tester");
  const pkg = project.packageJson;
  const configs = seededConfigs();
  // The scripts name these two files; their settings are the template's call.
  config(configs.get("tsconfig.json"));
  const check = config(configs.get("tsconfig.typecheck.json"));
  expect(pkg.devDependencies.typescript).toBe(TOOL_VERSIONS.typescript);
  expect(pkg.devDependencies.tsdown).toBeUndefined();
  expect(pkg.main).toBeUndefined();
  expect(pkg.types).toBeUndefined();
  expect(pkg.exports).toBeUndefined();
  expect(pkg.scripts.build).toBe("tsc --project tsconfig.json");
  expect(pkg.scripts.typecheck).toBe(
    "tsc --project tsconfig.typecheck.json --noEmit",
  );
  expect(check.extends).toBe("./tsconfig.json");
});

test("library build publishes the same entry and declarations that tsdown emits", () => {
  const project = buildProject("library", "sample", "tester");
  const pkg = project.packageJson;
  expect(pkg.scripts.build).toBe("sh scripts/build.sh");
  expect(pkg.devDependencies.tsdown).toBeDefined();
  expect(pkg.main).toBe("dist/index.mjs");
  expect(pkg.types).toBe("dist/index.d.ts");
  expect(pkg.exports?.["."]).toEqual({
    import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
    require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
  });
  expect(pkg.files).toEqual(["dist"]);
  // tsdown.config.json and scripts/build.sh are provided by the library-build template
  expect(project.templates.map((template) => template.path)).toContain(
    "templates/library-build",
  );
});

/** How each kind's sample project is laid out and what its compiler must do. */
type SampleTraits = {
  /** Whether a tests/ folder exists for the typecheck config to pick up. */
  tests: boolean;
  /** The runtime that decides module resolution and whether `tsc` emits. */
  runtime: "node" | "bun";
};

const SAMPLES: Record<string, SampleTraits> = {
  library: { tests: true, runtime: "node" },
  "forge-app": { tests: false, runtime: "node" },
  tool: { tests: true, runtime: "bun" },
  "agent-skill": { tests: true, runtime: "bun" },
};

/** Lay out a minimal project whose configs are reconciled exactly as `update` would. */
function writeSampleProject(
  folder: string,
  kind: string,
  traits: SampleTraits,
) {
  const project = buildProject(kind, "sample", "tester");
  expect(project.packageJson.type).toBe("module");
  mkdirSync(join(folder, "src"), { recursive: true });
  writeFileSync(
    join(folder, "package.json"),
    JSON.stringify(project.packageJson),
  );
  writeFileSync(
    join(folder, "src/index.ts"),
    "export const value: number = 1;\n",
  );
  if (traits.tests) {
    mkdirSync(join(folder, "tests"));
    writeFileSync(
      join(folder, "tests/index.test.ts"),
      'import { test } from "bun:test";\ntest("sample", () => {});\n',
    );
  }
  const configs = TYPESCRIPT_CONFIGS.filter(
    (path) => path !== "tsconfig.declarations.json" || kind === "library",
  );
  for (const path of configs) {
    const seed = typescriptTemplates().get(path) ?? "";
    writeFileSync(
      join(folder, path),
      reconcileTypeScriptConfig(
        path,
        seed,
        seed,
        project.packageJson.devDependencies,
        traits.runtime,
      ),
    );
  }
  return configs;
}

/** What the compiler says about one generated config, without asserting anything itself. */
function compile(folder: string, path: string) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    join(folder, path),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  );
  const program = parsed && ts.createProgram(parsed.fileNames, parsed.options);
  return {
    errors: parsed?.errors ?? [],
    includesTests:
      parsed?.fileNames.some((name) => name.endsWith("index.test.ts")) ?? false,
    diagnostics: program
      ? ts
          .getPreEmitDiagnostics(program)
          .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))
      : [],
    program,
  };
}

test.each(Object.entries(SAMPLES))(
  "%s generated TypeScript configs typecheck and compile a sample entry",
  (kind, traits) => {
    mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
    const root = mkdtempSync(join(process.cwd(), ".scratch/tmp_rovo_build_"));
    try {
      const folder = join(root, kind);
      for (const path of writeSampleProject(folder, kind, traits)) {
        const { errors, includesTests, diagnostics, program } = compile(
          folder,
          path,
        );
        expect(errors).toEqual([]);
        expect(includesTests).toBe(
          path === "tsconfig.typecheck.json" && traits.tests,
        );
        expect(diagnostics).toEqual([]);
        // Only the main config of a Node project emits JavaScript.
        if (path === "tsconfig.json" && traits.runtime === "node") {
          expect(program?.emit().emitSkipped).toBe(false);
          expect(readFileSync(join(folder, "dist/index.js"), "utf8")).toContain(
            "export const value",
          );
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test.each(["agent-skill"])("%s typechecks without building", (kind) => {
  const project = buildProject(kind, "sample", "tester");
  expect(project.packageJson.scripts.build).toBeUndefined();
  expect(project.packageJson.scripts.typecheck).toBe(
    "tsc --project tsconfig.typecheck.json --noEmit",
  );
  expect(
    config(seededConfigs().get("tsconfig.json")).compilerOptions,
  ).toMatchObject({
    rootDir: "src",
    outDir: "dist",
  });
});
