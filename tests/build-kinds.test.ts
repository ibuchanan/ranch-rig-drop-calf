import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import {
  reconcileTypeScriptConfig,
  TYPESCRIPT_CONFIGS,
} from "../src/typescript.ts";
import { typescriptTemplates } from "./templates-source.ts";

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

test("generated TypeScript configs typecheck and compile a sample entry", () => {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  const root = mkdtempSync(join(process.cwd(), ".scratch/tmp_rovo_build_"));
  try {
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const project = buildProject(kind, "sample", "tester");
      const folder = join(root, kind);
      mkdirSync(join(folder, "src"), { recursive: true });
      writeFileSync(
        join(folder, "package.json"),
        JSON.stringify(project.packageJson),
      );
      writeFileSync(
        join(folder, "src/index.ts"),
        "export const value: number = 1;\n",
      );
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
          ),
        );
      }
      for (const path of configs) {
        const parsed = ts.getParsedCommandLineOfConfigFile(
          join(folder, path),
          {},
          { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
        );
        expect(parsed?.errors).toEqual([]);
        if (!parsed) continue;
        const program = ts.createProgram(parsed.fileNames, parsed.options);
        expect(
          ts
            .getPreEmitDiagnostics(program)
            .map((d) => ts.flattenDiagnosticMessageText(d.messageText, " ")),
        ).toEqual([]);
        if (path === "tsconfig.json")
          expect(program.emit().emitSkipped).toBe(false);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(["tool", "agent-skill"])(
  "%s emits TypeScript from src into dist",
  (kind) => {
    const project = buildProject(kind, "sample", "tester");
    expect(project.packageJson.scripts.build).toBe(
      "tsc --project tsconfig.json",
    );
    expect(project.packageJson.scripts.typecheck).toBe(
      "tsc --project tsconfig.typecheck.json --noEmit",
    );
    expect(
      config(seededConfigs().get("tsconfig.json")).compilerOptions,
    ).toMatchObject({
      rootDir: "src",
      outDir: "dist",
    });
  },
);
