import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  LIBRARY_BUILD_COMMAND,
  LIBRARY_BUILD_CONFIG,
  LIBRARY_BUILD_SCRIPT,
  libraryBuild,
} from "../../src/capabilities/library-build.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import {
  updateCapabilities,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { libraryBuildTemplates } from "../support/templates-source.ts";

const templates = libraryBuildTemplates();

test("init seeds reference-style conditional exports, config and shared pipeline", async () => {
  const source = mockModuleSource();
  const stub = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const project = buildProject("library", "sample", "tester");
    expect(project.templates.map((template) => template.path)).toContain(
      "templates/library-build",
    );
    expect(project.files.has(LIBRARY_BUILD_CONFIG)).toBe(false);
    const module = new DropCalf();
    const output = (await module.init(
      mockDirectory(),
      "library",
      "tester",
      "sample",
    )) as ReturnType<typeof mockDirectory>;
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg).toMatchObject({
      main: "dist/index.mjs",
      types: "dist/index.d.ts",
      files: ["dist"],
      scripts: { build: LIBRARY_BUILD_COMMAND },
      exports: {
        ".": {
          import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
          require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
        },
      },
    });
    expect(await output.file(LIBRARY_BUILD_CONFIG).contents()).toEqual(
      templates.get(LIBRARY_BUILD_CONFIG) ?? "",
    );
    expect(await output.file(LIBRARY_BUILD_SCRIPT).contents()).toEqual(
      templates.get(LIBRARY_BUILD_SCRIPT) ?? "",
    );
    expect(await output.exists("tsconfig.declarations.json")).toBe(true);
    expect(
      ((await module.update(output, "library")) as typeof output).files,
    ).toEqual(output.files);
  } finally {
    stub.mockRestore();
    source.mockRestore();
  }
});

test("update enforces pipeline and formats while preserving owner entries and publishing fields", async () => {
  const source = mockModuleSource();
  try {
    const pkg = {
      name: "@example/errors",
      main: "dist/errors.mjs",
      types: "dist/errors.d.ts",
      files: ["dist"],
      exports: {
        ".": { import: "./dist/errors.mjs", require: "./dist/errors.cjs" },
        "./testing": {
          import: "./dist/testing.mjs",
          require: "./dist/testing.cjs",
        },
      },
      scripts: { build: "owner build", test: "bun test" },
      devDependencies: { tsdown: "0.1", typescript: "^5.9" },
    };
    const config = {
      entry: { index: "./src/errors.ts", testing: "./src/testing.ts" },
      format: ["esm"],
      sourcemap: true,
      deps: { neverBundle: ["vitest"] },
    };
    const original = structuredClone(pkg);
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        [LIBRARY_BUILD_CONFIG, JSON.stringify(config)],
        [LIBRARY_BUILD_SCRIPT, "owner script"],
        ["tsconfig.json", "owner compiler config"],
        ["tsconfig.declarations.json", "owner declaration config"],
        ["bun.lock", "owner lockfile"],
      ]),
    );
    const output = (await runUpdate(libraryBuild(), input)) as typeof input;
    const updated = JSON.parse(await output.file("package.json").contents());
    pkg.scripts.build = LIBRARY_BUILD_COMMAND;
    pkg.devDependencies.tsdown = TOOL_VERSIONS.tsdown;
    expect(updated).toEqual(pkg);
    expect(updated.exports).toEqual(original.exports);
    config.format = ["esm", "cjs"];
    expect(
      JSON.parse(await output.file(LIBRARY_BUILD_CONFIG).contents()),
    ).toEqual(config);
    expect(await output.file(LIBRARY_BUILD_SCRIPT).contents()).toEqual(
      templates.get(LIBRARY_BUILD_SCRIPT) ?? "",
    );
    for (const path of [
      "tsconfig.json",
      "tsconfig.declarations.json",
      "bun.lock",
    ])
      expect(await output.file(path).contents()).toEqual(
        input.files.get(path) ?? "",
      );
    expect(await runUpdate(libraryBuild(), output)).toBe(output);
  } finally {
    source.mockRestore();
  }
});

test("missing policy files are restored; owner config deletions are retained", async () => {
  const source = mockModuleSource();
  try {
    const config =
      '{ "entry": {"custom":"./src/custom.ts"}, "format": ["esm","cjs"] }';
    const input = mockDirectory(new Map([[LIBRARY_BUILD_CONFIG, config]]));
    const output = (await runUpdate(libraryBuild(), input)) as typeof input;
    expect(await output.file(LIBRARY_BUILD_CONFIG).contents()).toEqual(config);
    expect(await runUpdate(libraryBuild(), output)).toBe(output);
    const missing = await runUpdate(
      libraryBuild(),
      mockDirectory(new Map([["package.json", "{}"]])),
    );
    expect(await missing.file(LIBRARY_BUILD_CONFIG).contents()).toEqual(
      templates.get(LIBRARY_BUILD_CONFIG) ?? "",
    );
    expect(
      JSON.parse(await missing.file("package.json").contents()).exports,
    ).toBeUndefined();
  } finally {
    source.mockRestore();
  }
});

test.each(["{broken", "null", "[]"])(
  "update rejects malformed bundler config: %s",
  async (contents) => {
    const source = mockModuleSource();
    try {
      const input = mockDirectory(
        new Map([
          ["package.json", "{}"],
          [LIBRARY_BUILD_CONFIG, contents],
        ]),
      );
      await expect(runUpdate(libraryBuild(), input)).rejects.toThrow(
        LIBRARY_BUILD_CONFIG,
      );
      expect(input.files.size).toBe(2);
    } finally {
      source.mockRestore();
    }
  },
);

test("executable or package config conflicts fail with migration guidance, never shadow owner settings", async () => {
  for (const extension of ["ts", "mts", "cts", "js", "mjs", "cjs"]) {
    const path = `tsdown.config.${extension}`;
    await expect(
      runUpdate(
        libraryBuild(),
        mockDirectory(
          new Map([
            ["package.json", "{}"],
            [path, "owner config"],
          ]),
        ),
      ),
    ).rejects.toThrow(`remove ${path}`);
  }
  await expect(
    runUpdate(
      libraryBuild(),
      mockDirectory(new Map([["package.json", '{"tsdown":{}}']])),
    ),
  ).rejects.toThrow("package.json#tsdown");
});

test("dependency convergence precedes compiler update on the first pass", async () => {
  const source = mockModuleSource();
  try {
    const names = resolveProfile("library").map((c) => c.name);
    expect(names.indexOf("library-build")).toBeLessThan(
      names.indexOf("typescript"),
    );
    const output = await updateCapabilities(
      mockDirectory(
        new Map([
          [
            "package.json",
            JSON.stringify({
              devDependencies: { tsdown: TOOL_VERSIONS.tsdown },
            }),
          ],
        ]),
      ),
      resolveProfile("library").filter(
        (c) => c.name === "library-build" || c.name === "typescript",
      ),
    );
    const base = JSON.parse(
      await output.file("tsconfig.declarations.json").contents(),
    );
    expect(base.compilerOptions.emitDeclarationOnly).toBe(true);
    expect(base.compilerOptions.moduleResolution).toBe("Bundler");
  } finally {
    source.mockRestore();
  }
});

test("validation explicitly skips because supported config loading would execute a build", async () => {
  const result = await validateCapabilities(mockDirectory(), [libraryBuild()]);
  expect(result[0]).toMatchObject({
    capability: "library-build",
    status: "skipped",
  });
  const skipped = result[0];
  if (skipped?.status !== "skipped") throw new Error("expected explicit skip");
  expect(skipped.reason).toContain("no supported configuration-only");
});
