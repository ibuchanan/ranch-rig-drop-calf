import { expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dag } from "@dagger.io/dagger";
import { libraryBuild } from "../src/capabilities.ts";
import { updateCapabilities, validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import {
  LIBRARY_BUILD_COMMAND,
  LIBRARY_BUILD_CONFIG,
  LIBRARY_BUILD_SCRIPT,
  updateLibraryBuild,
} from "../src/library-build.ts";
import { buildProject, resolveProfile } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { libraryBuildTemplates } from "./templates-source.ts";

const templates = libraryBuildTemplates();

test("init seeds reference-style conditional exports, config and shared pipeline", async () => {
  const source = mockModuleSource();
  const stub = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const project = buildProject("library", "sample", "tester");
    expect(project.templates).toContain("templates/library-build");
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

test("update enforces pipeline and formats while preserving the example's entries and publishing fields", async () => {
  const source = mockModuleSource();
  try {
    const pkg = JSON.parse(
      readFileSync("vendor/forge-ahead-errors/package.json", "utf8"),
    );
    const config = JSON.parse(
      readFileSync("vendor/forge-ahead-errors/tsdown.config.json", "utf8"),
    );
    const original = structuredClone(pkg);
    pkg.scripts.build = "owner build";
    pkg.devDependencies.tsdown = "0.1";
    config.format = ["esm"];
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
    const output = (await updateLibraryBuild(input)) as typeof input;
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
    expect(await updateLibraryBuild(output)).toBe(output);
  } finally {
    source.mockRestore();
  }
});

test("matching package/config bytes and owner deletions are retained; missing policy files are restored", async () => {
  const source = mockModuleSource();
  try {
    const pkg =
      '{ "devDependencies": { "tsdown": "^0.23" }, "scripts": { "build": "sh scripts/build.sh" } }';
    const config =
      '{ "entry": {"custom":"./src/custom.ts"}, "format": ["esm","cjs"] }';
    const input = mockDirectory(
      new Map([
        ["package.json", pkg],
        [LIBRARY_BUILD_CONFIG, config],
      ]),
    );
    const output = (await updateLibraryBuild(input)) as typeof input;
    expect(await output.file("package.json").contents()).toEqual(pkg);
    expect(await output.file(LIBRARY_BUILD_CONFIG).contents()).toEqual(config);
    expect(await updateLibraryBuild(output)).toBe(output);
    const missing = await updateLibraryBuild(
      mockDirectory(new Map([["package.json", "{}"]])),
    );
    expect(await missing.file(LIBRARY_BUILD_CONFIG).contents()).toEqual(
      templates.get(LIBRARY_BUILD_CONFIG) ?? "",
    );
    expect(
      JSON.parse(await missing.file("package.json").contents()).exports,
    ).toBeUndefined();
    const absent = mockDirectory();
    expect(await updateLibraryBuild(absent)).toBe(absent);
  } finally {
    source.mockRestore();
  }
});

test.each([
  "{broken",
  "null",
  "[]",
  '{"scripts":[]}',
  '{"devDependencies":null}',
])(
  "update rejects malformed shared metadata before writes: %s",
  async (contents) => {
    const input = mockDirectory(new Map([["package.json", contents]]));
    await expect(updateLibraryBuild(input)).rejects.toThrow("package.json");
    expect(input.files).toEqual(new Map([["package.json", contents]]));
  },
);

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
      await expect(updateLibraryBuild(input)).rejects.toThrow(
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
      updateLibraryBuild(
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
    updateLibraryBuild(
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
      mockDirectory(new Map([["package.json", "{}"]])),
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
