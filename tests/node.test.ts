import { describe, expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { buildProject } from "../src/profiles.ts";
import { NPMRC, nodeContainer } from "../src/node.ts";

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
      expect(pkg.engines).toEqual({ node: "24.x" });
      expect(pkg.devDependencies["@types/node"]).toBe("24");
    },
  );

  test("never authors a manifest.yml; `forge create` supplies it", () => {
    for (const kind of ["forge-app", "tool", "library", "agent-skill"])
      expect(
        buildProject(kind, "sample", "tester").files.has("manifest.yml"),
      ).toBe(false);
  });
});

test("nodeContainer builds the baseline image through native Dagger", () => {
  const images: string[] = [];
  const container = {
    from: (image: string) => {
      images.push(image);
      return container;
    },
  };
  const spy = spyOn(dag, "container").mockReturnValue(container as never);
  try {
    expect(nodeContainer()).toBe(container as never);
    expect(images).toEqual(["node:24"]);
  } finally {
    spy.mockRestore();
  }
});
