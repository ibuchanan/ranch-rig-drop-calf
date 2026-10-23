import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { release } from "../../src/capabilities/release.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s selects a required one-command release with one git-cliff owner",
  (kind) => {
    const selected = resolveProfile(kind);
    const project = buildProject(kind, "sample", "tester");
    const index = selected.findIndex(
      (capability) => capability.name === "release",
    );
    expect(selected[index - 1]?.name).toBe("changelog");
    expect(selected[index]?.selection).toBeUndefined();
    expect(project.packageJson.scripts.release).toBe("bash scripts/release.sh");
    expect(project.packageJson.scripts["release:prepare"]).toBeUndefined();
    expect(project.packageJson.scripts["release:publish"]).toBeUndefined();
    const manager = ["tool", "agent-skill"].includes(kind) ? "bun" : "npm";
    expect(project.packageJson.scripts["release:check"]).toBe(
      [
        `${manager} run test`,
        `${manager} run typecheck`,
        ...(kind === "library" ? [`${manager} run pack:check`] : []),
      ].join(" && "),
    );
    expect(project.templates.map((template) => template.path)).toContain(
      "templates/release",
    );
    expect(
      selected
        .filter(
          (capability) =>
            capability.packageJson?.seed?.devDependencies?.["git-cliff"],
        )
        .map((capability) => capability.name),
    ).toEqual(["changelog"]);
    expect(() => resolveProfile(kind, [], ["release"])).toThrow();
  },
);

test("update maintains helpers and release command but preserves owner checks and release files", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            version: "0.1.0",
            scripts: {
              release: "old",
              "release:check": "owner-check",
              custom: "owner",
            },
            devDependencies: { "git-cliff": "99.0.0" },
          }),
        ],
        ["scripts/release.sh", "owner edit"],
        ["cliff.toml", "# owner policy"],
        ["CHANGELOG.md", "owner notes"],
        ["package-lock.json", "owner lock"],
      ]),
    );
    const output = await runUpdate(release({ library: true }), input);
    const script = await output.file("scripts/release.sh").contents();
    expect(script).toContain('npm version "$version"');
    expect(script).toContain(
      "git add -- package.json package-lock.json CHANGELOG.md",
    );
    expect(script).not.toMatch(/@[A-Z_]+@/);
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg.scripts.release).toBe("bash scripts/release.sh");
    expect(pkg.scripts["release:check"]).toBe("owner-check");
    expect(pkg.scripts.custom).toBe("owner");
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.devDependencies["git-cliff"]).toBe("99.0.0");
    for (const path of ["cliff.toml", "CHANGELOG.md", "package-lock.json"])
      expect(await output.file(path).contents()).toBe(
        await input.file(path).contents(),
      );
    expect(await runUpdate(release({ library: true }), output)).toBe(output);
    const empty = mockDirectory();
    expect(await runUpdate(release(), empty)).toBe(empty);
  } finally {
    source.mockRestore();
  }
});

test("adoption fills a missing release check without deleting custom legacy commands", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            scripts: { "release:prepare": "custom-old-workflow" },
          }),
        ],
      ]),
    );
    const output = await runUpdate(release(), input);
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg.scripts["release:check"]).toBe(
      "npm run test && npm run typecheck",
    );
    expect(pkg.scripts["release:prepare"]).toBe("custom-old-workflow");
  } finally {
    source.mockRestore();
  }
});

test("standalone release validation cannot read files or invoke tools", async () => {
  const directory = new Proxy({} as Directory, {
    get() {
      throw new Error("unexpected file access");
    },
  });
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("unexpected tools");
  });
  try {
    expect(
      (await validateCapabilities(directory, [release()]))[0]?.status,
    ).toBe("skipped");
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});
