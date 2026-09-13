import { describe, expect, test } from "bun:test";
import { biomeLinting, forgeLinting } from "../src/capabilities.ts";
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

describe("profiles", () => {
  test("agent-skill profile omits the test script", () => {
    const project = createBlueprint("my-package", "", "MIT", "");
    for (const capability of PROFILES["agent-skill"] ?? []) {
      capability.addTo(project);
    }
    expect(project.packageJson.scripts.test).toBeUndefined();
  });
});
