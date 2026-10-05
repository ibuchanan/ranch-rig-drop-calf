import { describe, expect, test } from "bun:test";
import { biomeLinting, forgeLinting } from "../src/capabilities.ts";
import { DropCalf } from "../src/index.ts";
import { InvalidOptionsError, buildProject } from "../src/profiles.ts";
import { PROFILES } from "../src/profiles.ts";
import { buildReadme, createBlueprint } from "../src/project.ts";

describe("buildReadme", () => {
  test("uses the package name as the title", () => {
    const readme = buildReadme("my-package", "", "none");
    expect(readme).toContain("# my-package");
  });
});

describe("biomeLinting capability", () => {
  test("adds lint scripts, dependency, and config", () => {
    const project = createBlueprint("my-package", "", "MIT", "");
    biomeLinting().addTo(project);
    expect(project.packageJson.scripts.lint).toBe("biome lint");
    expect(project.packageJson.scripts["lint:fix"]).toBe("biome lint --write");
    expect(project.packageJson.devDependencies["@biomejs/biome"]).toBe(
      "^1.9.4",
    );
    expect(project.files.has("biome.json")).toBe(true);
  });
});

describe("forgeLinting capability", () => {
  test("uses forge lint without adding biome", () => {
    const project = createBlueprint("my-package", "", "MIT", "");
    forgeLinting().addTo(project);
    expect(project.packageJson.scripts.lint).toBe("forge lint");
    expect(
      project.packageJson.devDependencies["@biomejs/biome"],
    ).toBeUndefined();
    expect(project.files.has("biome.json")).toBe(false);
  });
});

describe("kind selection", () => {
  test("rejects unknown kinds before blueprint assembly", () => {
    expect(() => buildProject("unknown", "sample")).toThrow(
      InvalidOptionsError,
    );
    expect(() => buildProject("unknown", "sample")).toThrow(
      /library.*forge-app.*tool.*agent-skill/,
    );
  });

  test("rejects ambiguous kinds and optional selections", () => {
    for (const kind of [undefined, "", "library,tool", "Library"]) {
      expect(() => buildProject(kind, "sample")).toThrow(InvalidOptionsError);
    }
    expect(() =>
      buildProject("forge-app", "sample", "", "MIT", "", ["unknown"]),
    ).toThrow(/unknown/);
    expect(() =>
      buildProject("forge-app", "sample", "", "MIT", "", ["evals"], ["evals"]),
    ).toThrow(/evals/);
    expect(() =>
      buildProject("library", "sample", "", "MIT", "", [], ["test"]),
    ).toThrow(/test/);
  });

  test("Dagger files rejects invalid selection before workspace or rendering", async () => {
    await expect(
      new DropCalf().files(undefined as unknown as string, "sample"),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().files("tool", "sample", "", "MIT", "", ["evals"]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    await expect(
      new DropCalf().files("library", "sample", "", "MIT", "", [], ["lint"]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
  });
});

describe("OSS document seeds", () => {
  test("generates project-specific authored documents for each kind", () => {
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const project = buildProject(
        kind,
        "example-project",
        "Example purpose",
        "MIT",
        "Example Owner",
      );
      expect(project.files.get("LICENSE")).toContain("Example Owner");
      expect(project.files.get("LICENSE")).toContain(
        String(new Date().getFullYear()),
      );
      expect(project.files.get("CONTRIBUTING.md")).toContain("example-project");
      expect(project.files.get("CODE_OF_CONDUCT.md")).toContain(
        "harassment-free",
      );
      expect(project.files.get("README.md")).toContain("Example purpose");
      expect(project.files.get("DEVELOPMENT.md")).toContain(
        "npm run typecheck",
      );
      expect(project.files.get(".atlassian/OWNER")).toBe("Example Owner\n");
    }
    expect(
      buildProject("tool", "sample", "", "none").files.has("LICENSE"),
    ).toBe(false);
  });
});

describe("profiles", () => {
  test.each([
    ["library", "biome lint", "tsdown", "bun test"],
    ["forge-app", "forge lint", "tsc -p tsconfig.json", "bun test"],
    ["tool", "biome lint", "tsc", "bun test"],
    ["agent-skill", "biome lint", "tsc", undefined],
  ])("%s fills the stable developer slots", (kind, lint, build, testScript) => {
    const { packageJson } = buildProject(kind, "sample");
    expect(packageJson.scripts).toMatchObject({
      lint,
      format: "biome format --write",
      typecheck: "tsc --noEmit",
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
    const base = buildProject("forge-app", "sample");
    expect(base.packageJson.scripts.eval).toBeUndefined();
    const selected = buildProject("forge-app", "sample", "", "MIT", "", [
      "evals",
    ]);
    expect(selected.packageJson.scripts.eval).toBeDefined();
    expect(selected.packageJson.scripts.test).toBe("bun test");
    expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
    const all = buildProject(
      "forge-app",
      "sample",
      "",
      "none",
      "",
      [],
      [],
      "all",
    );
    expect(all.packageJson.scripts.eval).toBeDefined();
    const excluded = buildProject(
      "forge-app",
      "sample",
      "",
      "none",
      "",
      [],
      ["evals"],
      "all",
    );
    expect(excluded.packageJson.scripts.eval).toBeUndefined();
    expect(excluded.packageJson.scripts.test).toBe("bun test");
    expect(() =>
      buildProject("forge-app", "sample", "", "MIT", "", [], [], "unknown"),
    ).toThrow(InvalidOptionsError);
    expect(
      buildProject("tool", "sample", "", "MIT", "", [], [], "all").packageJson
        .scripts.eval,
    ).toBeUndefined();
  });

  test("agent-skill contains no test scripts and all kinds keep a complete blueprint", () => {
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const project = buildProject(kind, "sample", "", "none");
      expect({
        packageJson: project.packageJson,
        files: [...project.files.keys()].sort(),
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
    const project = createBlueprint("my-package", "", "MIT", "");
    for (const capability of PROFILES["agent-skill"] ?? []) {
      capability.addTo(project);
    }
    expect(project.packageJson.scripts.test).toBeUndefined();
  });
});
