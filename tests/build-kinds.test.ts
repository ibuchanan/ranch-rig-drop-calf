import { expect, test } from "bun:test";
import ts from "typescript";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../src/profiles.ts";
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

test("every kind shares one seeded, bundler-compatible TypeScript config", () => {
  const project = buildProject("forge-app", "sample", "tester");
  const pkg = project.packageJson;
  const configs = seededConfigs();
  const base = config(configs.get("tsconfig.json"));
  const check = config(configs.get("tsconfig.typecheck.json"));
  expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
  expect(pkg.devDependencies.tsdown).toBeUndefined();
  expect(pkg.main).toBeUndefined();
  expect(pkg.types).toBeUndefined();
  expect(pkg.exports).toBeUndefined();
  expect(pkg.scripts.build).toBe("tsc --project tsconfig.json");
  expect(pkg.scripts.typecheck).toBe(
    "tsc --project tsconfig.typecheck.json --noEmit",
  );
  expect(base.compilerOptions).toMatchObject({
    target: "ES2022",
    module: "CommonJS",
    moduleResolution: "Node",
    jsx: "react-jsx",
    sourceMap: true,
    lib: ["ES2022"],
    forceConsistentCasingInFileNames: true,
    strict: true,
    rootDir: "src",
    outDir: "dist",
  });
  expect(check.extends).toBe("./tsconfig.json");
  expect(check.compilerOptions).toMatchObject({
    noEmit: true,
    noImplicitReturns: true,
    noUncheckedSideEffectImports: true,
    noImplicitOverride: true,
    noPropertyAccessFromIndexSignature: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
  });
  // Biome's recommended set reports unused locals/parameters and switch
  // fallthrough, so the seeded config deliberately omits the tsc duplicates.
  expect(check.compilerOptions).not.toHaveProperty("noUnusedLocals");
  expect(check.compilerOptions).not.toHaveProperty("noUnusedParameters");
  expect(check.compilerOptions).not.toHaveProperty(
    "noFallthroughCasesInSwitch",
  );
  // The rationale comments are the reason these are templates, not settings.
  expect(typescriptTemplates().get("tsconfig.json")).toContain("Forge Bundler");
});

test("library build publishes the same entry and declarations that tsdown emits", () => {
  const project = buildProject("library", "sample", "tester");
  const pkg = project.packageJson;
  expect(pkg.scripts.build).toBe("tsdown");
  expect(pkg.devDependencies.tsdown).toBeDefined();
  expect(pkg.main).toBe("./dist/index.js");
  expect(pkg.types).toBe("./dist/index.d.ts");
  expect(pkg.exports?.["."]).toEqual({
    types: "./dist/index.d.ts",
    default: "./dist/index.js",
  });
  expect(project.files.get("tsdown.config.ts")).toContain("src/index.ts");
  expect(project.files.get("tsdown.config.ts")).toContain("dts: true");
});

test("generated TypeScript configs typecheck and compile a sample entry", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_build_"));
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
      for (const [path, contents] of typescriptTemplates())
        writeFileSync(join(folder, path), contents);
      for (const path of ["tsconfig.json", "tsconfig.typecheck.json"]) {
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
