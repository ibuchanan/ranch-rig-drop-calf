import { expect, test } from "bun:test";
import ts from "typescript";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildProject } from "../src/profiles.ts";

function config(text: string | undefined) {
  const result = ts.parseConfigFileTextToJson("tsconfig.json", text ?? "");
  expect(result.error).toBeUndefined();
  return result.config;
}

test("Forge builds with bundler-compatible TypeScript and a strict no-emit typecheck", () => {
  const project = buildProject("forge-app", "sample", "tester");
  const pkg = project.packageJson;
  const base = config(project.files.get("tsconfig.json"));
  const check = config(project.files.get("tsconfig.typecheck.json"));
  expect(pkg.devDependencies.typescript).toMatch(/^\^5\./);
  expect(pkg.devDependencies.tsdown).toBeUndefined();
  expect(pkg.main).toBeUndefined();
  expect(pkg.types).toBeUndefined();
  expect(pkg.exports).toBeUndefined();
  expect(pkg.scripts.build).toBe("tsc -p tsconfig.json");
  expect(pkg.scripts.typecheck).toBe("tsc -p tsconfig.typecheck.json --noEmit");
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
    noUnusedLocals: true,
    noUnusedParameters: true,
    noFallthroughCasesInSwitch: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
  });
});

test("library build publishes the same entry and declarations that tsdown emits", () => {
  const project = buildProject("library", "sample", "tester");
  const pkg = project.packageJson;
  const compiler = config(project.files.get("tsconfig.json")).compilerOptions;
  expect(pkg.scripts.build).toBe("tsdown");
  expect(pkg.devDependencies.tsdown).toBeDefined();
  expect(pkg.main).toBe("./dist/index.js");
  expect(pkg.types).toBe("./dist/index.d.ts");
  expect(pkg.exports?.["."]).toEqual({
    types: "./dist/index.d.ts",
    default: "./dist/index.js",
  });
  expect(compiler).toMatchObject({
    module: "NodeNext",
    moduleResolution: "NodeNext",
    declaration: true,
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
      for (const path of ["tsconfig.json", "tsconfig.typecheck.json"]) {
        const contents = project.files.get(path);
        if (contents) writeFileSync(join(folder, path), contents);
      }
      for (const path of [
        "tsconfig.json",
        ...(kind === "forge-app" ? ["tsconfig.typecheck.json"] : []),
      ]) {
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
    expect(project.packageJson.scripts.build).toBe("tsc");
    expect(project.packageJson.scripts.typecheck).toBe("tsc --noEmit");
    expect(
      config(project.files.get("tsconfig.json")).compilerOptions,
    ).toMatchObject({
      rootDir: "src",
      outDir: "dist",
      declaration: true,
    });
  },
);
