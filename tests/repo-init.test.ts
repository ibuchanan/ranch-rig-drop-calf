import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { biomeLinting, forgeLinting } from "../src/capabilities.ts";
import { DropCalf } from "../src/index.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import {
  buildProject,
  InvalidOptionsError,
  PROFILES,
} from "../src/profiles.ts";
import { buildReadme, createBlueprint } from "../src/project.ts";
import { mockModuleSource } from "./module-source.ts";

let moduleSource: ReturnType<typeof mockModuleSource>;
beforeEach(() => {
  moduleSource = mockModuleSource();
});
afterEach(() => {
  moduleSource.mockRestore();
});

test("files uses matching local Biome init defaults without losing required policy", async () => {
  const root = process.cwd();
  const temp = mkdtempSync(join(root, "tmp_rovo_biome_"));
  const bin = join(temp, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "biome");
  writeFileSync(
    executable,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Version: 1.9.4"; exit 0; fi\nif [ "$1" = "init" ]; then printf \'{"$schema":"https://biomejs.dev/schemas/1.9.4/schema.json","javascript":{"formatter":{"quoteStyle":"single"}},"formatter":{"indentStyle":"tab"}}\\n\' > biome.json; exit 0; fi\nexit 1\n',
  );
  chmodSync(executable, 0o755);
  const writes = new Map<string, string>();
  const directory = {
    withNewFile: (path: string, content: string) => {
      writes.set(path, content);
      return directory;
    },
    withFile: (path: string, file: { text: string }) => {
      writes.set(path, file.text);
      return directory;
    },
    withDirectory: () => directory,
  } as unknown as Directory;
  const stub = spyOn(dag, "directory").mockReturnValue(directory);
  try {
    process.chdir(temp);
    await new DropCalf().files("tool", "tester", "sample");
    const config = JSON.parse(writes.get("biome.json") ?? "null");
    expect(config.javascript.formatter.quoteStyle).toBe("single");
    expect(config.formatter.indentStyle).toBe("space");
    expect(readFileSync(executable, "utf8")).toContain("init");
  } finally {
    process.chdir(root);
    stub.mockRestore();
    rmSync(temp, { recursive: true, force: true });
  }
});

test("files skips a mismatched local Biome and uses the fallback", async () => {
  const root = process.cwd();
  const temp = mkdtempSync(join(root, "tmp_rovo_biome_"));
  const bin = join(temp, "node_modules", ".bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "biome");
  writeFileSync(
    executable,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "Version: 2.5.15"; exit 0; fi\necho init > was-initialized\n',
  );
  chmodSync(executable, 0o755);
  const writes = new Map<string, string>();
  const directory = {
    withNewFile: (path: string, content: string) => {
      writes.set(path, content);
      return directory;
    },
    withFile: (path: string, file: { text: string }) => {
      writes.set(path, file.text);
      return directory;
    },
    withDirectory: () => directory,
  } as unknown as Directory;
  const stub = spyOn(dag, "directory").mockReturnValue(directory);
  try {
    process.chdir(temp);
    await new DropCalf().files("tool", "tester", "sample");
    expect(writes.get("biome.json")).toBe(
      buildProject("tool", "sample", "tester").files.get("biome.json"),
    );
    expect(existsSync(join(temp, "was-initialized"))).toBe(false);
  } finally {
    process.chdir(root);
    stub.mockRestore();
    rmSync(temp, { recursive: true, force: true });
  }
});

describe("buildReadme", () => {
  test("uses the package name as the title", () => {
    const readme = buildReadme("my-package", "");
    expect(readme).toContain("# my-package");
  });
});

describe("biomeLinting capability", () => {
  test("adds lint scripts, dependency, and config", () => {
    const project = createBlueprint("my-package", "", "");
    biomeLinting().addTo(project);
    expect(project.packageJson.scripts.lint).toBe("biome lint");
    expect(project.packageJson.scripts["lint:fix"]).toBe("biome lint --write");
    expect(project.packageJson.devDependencies["@biomejs/biome"]).toBe(
      "^1.9.4",
    );
    expect(project.files.has("biome.json")).toBe(true);
  });
});

test("generated kinds ship version-compatible Biome config and check scripts", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const project = buildProject(kind, "sample", "tester");
    const scripts = project.packageJson.scripts;
    const version = project.packageJson.devDependencies["@biomejs/biome"];
    const configText = project.files.get("biome.json") ?? "";
    const config = JSON.parse(configText);
    expect(configText.endsWith("\n")).toBe(true);
    expect(scripts.format).toBe("biome format --write");
    expect(scripts["format:check"]).toBe("biome format");
    expect(scripts["lint:check"]).toBe("biome lint");
    expect(scripts["lint:fix"]).toBe("biome lint --write");
    expect(config.$schema).toBe(
      `https://biomejs.dev/schemas/${version?.replace(/^[^\d]*/, "")}/schema.json`,
    );
  }
});

test("a requested Biome version determines its schema", () => {
  const project = createBlueprint("sample", "", "");
  biomeLinting("^1.9.3").addTo(project);
  expect(JSON.parse(project.files.get("biome.json") ?? "null").$schema).toBe(
    "https://biomejs.dev/schemas/1.9.3/schema.json",
  );
});

describe("forgeLinting capability", () => {
  test("uses forge lint without adding biome", () => {
    const project = createBlueprint("my-package", "", "");
    forgeLinting().addTo(project);
    expect(project.packageJson.scripts["lint:forge"]).toBe("forge lint");
    expect(
      project.packageJson.devDependencies["@biomejs/biome"],
    ).toBeUndefined();
    expect(project.files.has("biome.json")).toBe(false);
  });
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
      buildProject("forge-app", "sample", "tester", "", "", ["unknown"]),
    ).toThrow(/unknown/);
    expect(() =>
      buildProject(
        "forge-app",
        "sample",
        "tester",
        "",
        "",
        ["evals"],
        ["evals"],
      ),
    ).toThrow(/evals/);
    expect(() =>
      buildProject("library", "sample", "tester", "", "", [], ["test"]),
    ).toThrow(/test/);
  });

  test("Dagger files rejects invalid selection before workspace or rendering", async () => {
    await expect(
      new DropCalf().files(undefined as unknown as string, "tester", "sample"),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().files("tool", "tester", "sample", "", "", ["evals"]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().files("library", "tester", "sample", "", "", [], ["lint"]),
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

describe("profiles", () => {
  test("all kinds generate matching Node 24 pins", () => {
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const project = buildProject(kind, "sample", "tester");
      expect(project.files.get(".nvmrc")).toBe("24\n");
      expect(project.packageJson.engines).toEqual({ node: "24.x" });
    }
  });

  test.each([
    [
      "library",
      "lefthook run esa-lint",
      "tsdown",
      "bun test --pass-with-no-tests",
    ],
    [
      "forge-app",
      "lefthook run esa-lint",
      "tsc -p tsconfig.json",
      "bun test --pass-with-no-tests",
    ],
    ["tool", "lefthook run esa-lint", "tsc", "bun test --pass-with-no-tests"],
    ["agent-skill", "lefthook run esa-lint", "tsc", undefined],
  ])("%s fills the stable developer slots", (kind, lint, build, testScript) => {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts).toMatchObject({
      lint,
      format: "biome format --write",
      typecheck:
        kind === "forge-app"
          ? "tsc -p tsconfig.typecheck.json --noEmit"
          : "tsc --noEmit",
      build,
      clean: "rm -rf dist",
    });
    expect(packageJson.scripts.test).toBe(testScript);
    if (kind === "library") {
      expect(packageJson.devDependencies.tsdown).toBeDefined();
      expect(packageJson.main).toBe("./dist/index.js");
      expect(packageJson.types).toBe("./dist/index.d.ts");
      expect(packageJson.exports).toEqual({
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      });
    } else {
      expect(packageJson.devDependencies.tsdown).toBeUndefined();
      expect(packageJson.exports).toBeUndefined();
    }
    if (kind === "forge-app")
      expect(packageJson.devDependencies.typescript).toMatch(/^\^5/);
  });

  test("evals is opt-in without removing mandatory slots", () => {
    const base = buildProject("forge-app", "sample", "tester");
    expect(base.packageJson.scripts.eval).toBeUndefined();
    const selected = buildProject("forge-app", "sample", "tester", "", "", [
      "evals",
    ]);
    expect(selected.packageJson.scripts.eval).toBeDefined();
    expect(selected.packageJson.scripts.test).toBe(
      "bun test --pass-with-no-tests",
    );
    expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
    const all = buildProject(
      "forge-app",
      "sample",
      "tester",
      "",
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
      "",
      [],
      ["evals"],
      "all",
    );
    expect(excluded.packageJson.scripts.eval).toBeUndefined();
    expect(excluded.packageJson.scripts.test).toBe(
      "bun test --pass-with-no-tests",
    );
    expect(() =>
      buildProject("forge-app", "sample", "tester", "", "", [], [], "unknown"),
    ).toThrow(InvalidOptionsError);
    expect(
      buildProject("tool", "sample", "tester", "", "", [], [], "all")
        .packageJson.scripts.eval,
    ).toBeUndefined();
  });

  test("agent-skill contains no test scripts and all kinds keep a complete blueprint", () => {
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const project = buildProject(kind, "sample", "tester");
      expect({
        packageJson: project.packageJson,
        files: [...project.files.keys(), ...OSS_ASSETS].sort(),
      }).toMatchSnapshot(kind);
      if (kind === "agent-skill")
        expect(
          Object.keys(project.packageJson.scripts).some((key) =>
            key.startsWith("test"),
          ),
        ).toBe(false);
    }
  });

  test("agent-skill profile omits the test script", () => {
    const project = createBlueprint("my-package", "", "");
    for (const capability of PROFILES["agent-skill"] ?? []) {
      capability.addTo(project);
    }
    expect(project.packageJson.scripts.test).toBeUndefined();
  });
});
