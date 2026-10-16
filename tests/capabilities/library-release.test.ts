import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { readFileSync } from "node:fs";
import { libraryRelease } from "../../src/capabilities/library-release.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";

test("publication is an explicit library-only command alongside preparation", () => {
  expect(
    buildProject("library", "sample", "tester").packageJson.scripts[
      "release:publish"
    ],
  ).toBe("bun run scripts/release-publish.ts");
  for (const kind of ["forge-app", "tool", "agent-skill"])
    expect(
      buildProject(kind, "sample", "tester").packageJson.scripts[
        "release:publish"
      ],
    ).toBeUndefined();
});

test("update restores only its authored helper and command without preparing a release", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            version: "0.1.0",
            scripts: { "release:prepare": "old", changelog: "owner" },
            devDependencies: { "git-cliff": "99.0.0" },
          }),
        ],
        ["scripts/release-prepare.ts", "owner edit"],
        ["cliff.toml", "# owner policy"],
        ["CHANGELOG.md", "# owner notes"],
        ["package-lock.json", "owner lock"],
      ]),
    );
    const output = await runUpdate(libraryRelease(), input);
    expect(await output.file("scripts/release-prepare.ts").contents()).toBe(
      readFileSync(
        new URL(
          "../../templates/library-release/scripts/release-prepare.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(await output.file("scripts/release-publish.ts").contents()).toBe(
      readFileSync(
        new URL(
          "../../templates/library-release/scripts/release-publish.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg.scripts["release:publish"]).toBe(
      "bun run scripts/release-publish.ts",
    );
    expect(pkg.version).toBe("0.1.0");
    expect(pkg.scripts.changelog).toBe("owner");
    expect(pkg.devDependencies["git-cliff"]).toBe("99.0.0");
    for (const path of ["cliff.toml", "CHANGELOG.md", "package-lock.json"])
      expect(await output.file(path).contents()).toBe(
        await input.file(path).contents(),
      );
    expect(await runUpdate(libraryRelease(), output)).toBe(output);
    const empty = mockDirectory();
    expect(await runUpdate(libraryRelease(), empty)).toBe(empty);
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
      (await validateCapabilities(directory, [libraryRelease()]))[0]?.status,
    ).toBe("skipped");
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});

test("only libraries select local release preparation without a second git-cliff owner", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const selected = resolveProfile(kind);
    const project = buildProject(kind, "sample", "tester");
    if (kind === "library") {
      expect(selected.map((capability) => capability.name)).toContain(
        "library-release",
      );
      expect(project.packageJson.scripts["release:prepare"]).toBe(
        "bun run scripts/release-prepare.ts",
      );
      expect(project.templates.map((template) => template.path)).toContain(
        "templates/library-release",
      );
      expect(
        selected
          .filter(
            (capability) =>
              capability.packageJson?.seed?.devDependencies?.["git-cliff"],
          )
          .map((capability) => capability.name),
      ).toEqual(["changelog"]);
    } else {
      expect(selected.map((capability) => capability.name)).not.toContain(
        "library-release",
      );
      expect(project.packageJson.scripts["release:prepare"]).toBeUndefined();
    }
  }
});
