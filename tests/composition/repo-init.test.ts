import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import { dag } from "@dagger.io/dagger";
import ts from "typescript";
import { biomeToolchain } from "../../src/capabilities/biome.ts";
import { LINT_COMMAND } from "../../src/capabilities/lint.ts";
import { OSS_ASSETS } from "../../src/capabilities/oss.ts";
import { SECRETS_ASSETS } from "../../src/capabilities/secrets.ts";
import { buildProject, PROFILES } from "../../src/composition/profiles.ts";
import { InvalidOptionsError } from "../../src/core/errors.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit } from "../support/capability-fixtures.ts";
import { isBunKind } from "../support/kinds.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import {
  biomeTemplates,
  changelogTemplates,
  libraryBuildTemplates,
  typescriptTemplates,
  vitestTemplates,
} from "../support/templates-source.ts";

let moduleSource: ReturnType<typeof mockModuleSource>;
beforeEach(() => {
  moduleSource = mockModuleSource();
});
afterEach(() => {
  moduleSource.mockRestore();
});

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init seeds the pinned Biome and EditorConfig bytes",
  async (kind) => {
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    const exec = spyOn(childProcess, "execFileSync").mockImplementation(() => {
      throw new Error("Generation must not invoke a host tool");
    });
    const temp = spyOn(fs, "mkdtempSync").mockImplementation(() => {
      throw new Error("Generation must not create a host temporary directory");
    });
    try {
      for (const preset of [undefined, "all"]) {
        const result = await new DropCalf().init(
          mockDirectory(),
          kind,
          "tester",
          "sample",
          "",
          [],
          [],
          preset,
        );
        expect(await result.file("biome.jsonc").contents()).toBe(
          biomeTemplates().get("biome.jsonc") ?? "",
        );
        expect(await result.exists("biome.json")).toBe(false);
        if (kind === "forge-app")
          expect(await result.file("vitest.config.ts").contents()).toBe(
            vitestTemplates().get("vitest.config.ts") ?? "",
          );
        else expect(await result.exists("vitest.config.ts")).toBe(false);
        const check = JSON.parse(
          await result.file("tsconfig.typecheck.json").contents(),
        );
        expect(check.extends).toBe("./tsconfig.json");
        expect(check.include).toEqual([
          "src",
          "test",
          "tests",
          ...(kind === "forge-app" ? ["vitest.config.ts"] : []),
        ]);
        expect(await result.file(".editorconfig").contents()).toBe(
          biomeTemplates().get(".editorconfig") ?? "",
        );
      }
      expect(exec).not.toHaveBeenCalled();
      expect(temp).not.toHaveBeenCalled();
    } finally {
      temp.mockRestore();
      exec.mockRestore();
      stub.mockRestore();
    }
  },
);

describe("biomeToolchain capability", () => {
  test("adds format and lint scripts and dependency without authoring config", () => {
    const project = createBlueprint("my-package", "", "");
    const capability = biomeToolchain();
    runInit(capability, project);
    expect(project.packageJson.scripts.format).toBe("biome format --write");
    expect(project.packageJson.scripts["format:check"]).toBe("biome format");
    expect(project.packageJson.scripts["lint:check"]).toBe("biome lint");
    expect(project.packageJson.scripts.lint).toBeUndefined();
    expect(project.packageJson.scripts["lint:fix"]).toBe("biome lint --write");
    expect(project.packageJson.devDependencies["@biomejs/biome"]).toBe(
      TOOL_VERSIONS.biome,
    );
    expect(project.files.has("biome.jsonc")).toBe(false);
  });
});

test("generated kinds install pinned Biome and check scripts", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const project = buildProject(kind, "sample", "tester");
    const scripts = project.packageJson.scripts;
    const version = project.packageJson.devDependencies["@biomejs/biome"];
    expect(scripts.format).toBe("biome format --write");
    expect(scripts["format:check"]).toBe("biome format");
    expect(scripts["lint:check"]).toBe("biome lint");
    expect(scripts.lint).toBe(
      isBunKind(kind)
        ? LINT_COMMAND.replace("--npm-path npm", "--npm-path bun")
        : LINT_COMMAND,
    );
    expect(scripts["lint:fix"]).toBe("biome lint --write");
    expect(version).toBe(TOOL_VERSIONS.biome);
  }
});

test("the pinned Biome template schema matches the version registry", () => {
  const parsed = ts.parseConfigFileTextToJson(
    "biome.jsonc",
    biomeTemplates().get("biome.jsonc") ?? "",
  );
  expect(parsed.error).toBeUndefined();
  expect(parsed.config.$schema).toBe(
    `https://biomejs.dev/schemas/${TOOL_VERSIONS.biome}/schema.json`,
  );
});

describe("kind selection", () => {
  test("rejects unknown kinds before blueprint assembly", () => {
    expect(() => buildProject("unknown", "sample", "tester")).toThrow(
      InvalidOptionsError,
    );
    expect(() => buildProject("unknown", "sample", "tester")).toThrow(
      /library.*forge-app.*tool.*agent-skill/,
    );
  });

  test("rejects ambiguous kinds and optional selections", () => {
    for (const kind of [undefined, "", "library,tool", "Library"]) {
      expect(() => buildProject(kind, "sample", "tester")).toThrow(
        InvalidOptionsError,
      );
    }
    expect(() =>
      buildProject("forge-app", "sample", "tester", "", ["unknown"]),
    ).toThrow(/unknown/);
    expect(() =>
      buildProject("forge-app", "sample", "tester", "", ["evals"], ["evals"]),
    ).toThrow(/evals/);
    expect(() =>
      buildProject("library", "sample", "tester", "", [], ["test"]),
    ).toThrow(/test/);
  });

  test("init rejects invalid selection before rendering", async () => {
    await expect(
      new DropCalf().init(
        mockDirectory(),
        undefined as unknown as string,
        "tester",
        "sample",
      ),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().init(mockDirectory(), "tool", "tester", "sample", "", [
        "evals",
      ]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().init(
        mockDirectory(),
        "library",
        "tester",
        "sample",
        "",
        [],
        ["lint"],
      ),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});

test("OSS documents reject invalid/blank owner", () => {
  expect(() => buildProject("tool", "sample", "")).toThrow(/owner/i);
  expect(() => buildProject("tool", "sample", "   ")).toThrow(/owner/i);
  expect(() => buildProject("tool", "sample", "invalid owner")).toThrow(
    /owner/i,
  );
});

test("the blueprint leaves license metadata to catalog consumers", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"])
    expect(
      buildProject(kind, "sample", "tester").packageJson.license,
    ).toBeUndefined();
});

describe("profiles", () => {
  test("Node-based kinds generate matching project Node pins", () => {
    for (const kind of ["library", "forge-app"]) {
      const project = buildProject(kind, "sample", "tester");
      expect(project.files.get(".nvmrc")).toBe(
        kind === "library" ? "22\n" : "24\n",
      );
      expect(project.packageJson.engines).toBeUndefined();
    }
  });

  test.each([
    [
      "library",
      LINT_COMMAND,
      "sh scripts/build.sh",
      "bun test --pass-with-no-tests",
    ],
    [
      "forge-app",
      LINT_COMMAND,
      "tsc --project tsconfig.json",
      "vitest run --passWithNoTests",
    ],
    [
      "tool",
      LINT_COMMAND.replace("--npm-path npm", "--npm-path bun"),
      "bun build --compile ./src/index.ts --outfile ./dist/cli",
      "bun test --pass-with-no-tests",
    ],
    [
      "agent-skill",
      LINT_COMMAND.replace("--npm-path npm", "--npm-path bun"),
      undefined,
      "bun test --pass-with-no-tests",
    ],
  ])("%s fills the stable developer slots", (kind, lint, build, testScript) => {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts).toMatchObject({
      lint,
      format: "biome format --write",
      typecheck: "tsc --project tsconfig.typecheck.json --noEmit",
      ...(build ? { build } : {}),
    });
    if (!build) expect(packageJson.scripts.build).toBeUndefined();
    expect(packageJson.scripts.clean).toBe(
      kind === "library"
        ? "rm -rf node_modules package-lock.json dist"
        : "rm -rf dist",
    );
    expect(packageJson.scripts.test).toBe(testScript);
    if (kind === "library") {
      expect(packageJson.devDependencies.tsdown).toBeDefined();
      expect(packageJson.main).toBe("dist/index.cjs");
      expect(packageJson.types).toBe("dist/index.d.ts");
      expect(packageJson.files).toEqual(["dist"]);
      expect(packageJson.exports).toEqual({
        ".": {
          import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      });
    } else {
      expect(packageJson.devDependencies.tsdown).toBeUndefined();
      expect(packageJson.exports).toBeUndefined();
    }
    if (kind === "forge-app")
      expect(packageJson.devDependencies.typescript).toBe(
        TOOL_VERSIONS.typescript,
      );
  });

  test("evals is opt-in without removing mandatory slots", () => {
    const base = buildProject("forge-app", "sample", "tester");
    expect(base.packageJson.scripts.eval).toBeUndefined();
    const selected = buildProject("forge-app", "sample", "tester", "", [
      "evals",
    ]);
    expect(selected.packageJson.scripts.eval).toBeDefined();
    expect(selected.packageJson.scripts.test).toBe(
      "vitest run --passWithNoTests",
    );
    expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
    const all = buildProject(
      "forge-app",
      "sample",
      "tester",
      "",
      [],
      [],
      "all",
    );
    expect(all.packageJson.scripts.eval).toBeDefined();
    const excluded = buildProject(
      "forge-app",
      "sample",
      "tester",
      "",
      [],
      ["evals"],
      "all",
    );
    expect(excluded.packageJson.scripts.eval).toBeUndefined();
    expect(excluded.packageJson.scripts.test).toBe(
      "vitest run --passWithNoTests",
    );
    expect(() =>
      buildProject("forge-app", "sample", "tester", "", [], [], "unknown"),
    ).toThrow(InvalidOptionsError);
    expect(
      buildProject("tool", "sample", "tester", "", [], [], "all").packageJson
        .scripts.eval,
    ).toBeUndefined();
  });

  test("all kinds expose testing workflows and keep a complete blueprint", async () => {
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
        const project = buildProject(kind, "sample", "tester");
        const result = await new DropCalf().init(
          mockDirectory(),
          kind,
          "tester",
          "sample",
        );
        const packageJson = JSON.parse(
          await result.file("package.json").contents(),
        );
        const paths = [
          ...project.files.keys(),
          ...OSS_ASSETS,
          "biome.jsonc",
          ...(kind === "library" ? libraryBuildTemplates().keys() : []),
          ...[...typescriptTemplates().keys()].filter(
            (path) =>
              path !== "tsconfig.declarations.json" || kind === "library",
          ),
          ...changelogTemplates().keys(),
          ...(kind === "forge-app"
            ? ["vitest.config.ts", ...SECRETS_ASSETS]
            : []),
        ].sort();
        for (const path of paths)
          expect(await result.exists(path), `${kind} seeds ${path}`).toBe(true);
        expect(packageJson).toMatchObject(project.packageJson);
        expect(
          Object.keys(packageJson.scripts).some((key) =>
            key.startsWith("test"),
          ),
          `${kind} exposes a test script`,
        ).toBe(true);
      }
    } finally {
      stub.mockRestore();
    }
  });

  test("agent-skill selects Bun testing with a package policy, not a no-testing slot", () => {
    const testing = PROFILES["agent-skill"]?.find(
      (capability) => capability.name === "test",
    );
    expect(typeof testing?.init).not.toBe("function");
    expect(testing?.packageJson?.policy?.scripts).toMatchObject({
      test: "bun test --pass-with-no-tests",
    });
  });
});
