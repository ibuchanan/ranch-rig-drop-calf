import { describe, expect, test } from "bun:test";
import { NPMRC } from "../src/node.ts";
import { buildProject } from "../src/profiles.ts";

describe("node baseline", () => {
  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s pins one Node baseline across package.json, .nvmrc and .npmrc",
    (kind) => {
      const { packageJson: pkg, files } = buildProject(
        kind,
        "sample",
        "tester",
      );
      expect(files.get(".nvmrc")).toBe("24\n");
      expect(files.get(".npmrc")).toBe(NPMRC);
      expect(pkg.engines).toBeUndefined();
      expect(pkg.devDependencies["@types/node"]).toBe("24");
    },
  );

  test("never authors a manifest.yml; forge create supplies it", () => {
    for (const kind of ["forge-app", "tool", "library", "agent-skill"])
      expect(
        buildProject(kind, "sample", "tester").files.has("manifest.yml"),
      ).toBe(false);
  });
});
