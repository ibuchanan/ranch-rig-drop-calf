import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { updateCapabilities, validateCapabilities } from "../src/capability.ts";
import {
  CHANGELOG_COMMAND,
  CHANGELOG_CONFIG,
  CHANGELOG_TEMPLATE,
  changelogToolchain,
  updateChangelog,
  validateChangelog,
} from "../src/changelog.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { changelogTemplates } from "./templates-source.ts";

/**
 * Stand in for `dag.container()` so the validation paths are exercised without
 * an engine. `outputs` maps a command to what the container writes back.
 */
function mockContainer(outputs: Record<string, string>) {
  const commands: string[][] = [];
  const container = {
    from: () => container,
    withExec: (args: string[]) => {
      commands.push(args);
      return container;
    },
    withMountedDirectory: () => container,
    withWorkdir: () => container,
    stdout: async () => outputs[commands.at(-1)?.join(" ") ?? ""] ?? "",
  };
  return {
    commands,
    spy: spyOn(dag, "container").mockReturnValue(container as never),
  };
}

const directory = (present: boolean) =>
  ({ exists: async () => present }) as unknown as Parameters<
    typeof validateChangelog
  >[0];

test("changelog kinds install a pinned tool and script without authoring a policy", () => {
  for (const kind of ["library", "forge-app", "tool"]) {
    const project = buildProject(kind, "sample", "tester");
    expect(project.packageJson.devDependencies["git-cliff"]).toBe(
      TOOL_VERSIONS.gitCliff,
    );
    expect(project.packageJson.scripts.changelog).toBe(CHANGELOG_COMMAND);
    // The policy is seeded from `templates/changelog`, never written by the
    // capability, so no kind carries it in the blueprint.
    expect(project.files.has("cliff.toml")).toBe(false);
  }
  const skill = buildProject("agent-skill", "sample", "tester");
  expect(skill.packageJson.scripts.changelog).toBeUndefined();
  expect(skill.packageJson.devDependencies["git-cliff"]).toBeUndefined();
  expect(skill.files.has("cliff.toml")).toBe(false);
});

test("the release tree ships the policy file the changelog command reads", () => {
  const templates = changelogTemplates();
  expect(CHANGELOG_TEMPLATE).toBe("templates/changelog");
  expect(CHANGELOG_COMMAND).toContain(CHANGELOG_CONFIG);
  expect(templates.has(CHANGELOG_CONFIG)).toBe(true);
  expect(templates.has("CHANGELOG.md")).toBe(true);
});

test("init and update use the selected pin without claiming unrelated package fields", async () => {
  const capability = changelogToolchain("2.0.0");
  const project = createBlueprint("sample", "", "tester");
  if (typeof capability.init !== "function") throw new Error("missing init");
  capability.init(project);
  expect(project.templates.map((template) => template.path)).toEqual([
    CHANGELOG_TEMPLATE,
  ]);
  expect(project.packageJson.devDependencies["git-cliff"]).toBe("2.0.0");
  expect(project.packageJson.scripts.changelog).toBe(CHANGELOG_COMMAND);

  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: { changelog: "owner command", release: "owner release" },
          devDependencies: { "git-cliff": "old", owner: "1" },
          dependencies: { keep: "1" },
          custom: { keep: true },
        }),
      ],
      ["cliff.toml", "owner policy, even if invalid"],
      ["CHANGELOG.md", "owner output\r\n"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const output = await updateCapabilities(input, [capability]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    name: "owner",
    scripts: { changelog: CHANGELOG_COMMAND, release: "owner release" },
    devDependencies: { "git-cliff": "2.0.0", owner: "1" },
    dependencies: { keep: "1" },
    custom: { keep: true },
  });
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await updateCapabilities(output, [capability])).toBe(output);
});

test("update creates missing package sections but leaves missing seed files and package absent", async () => {
  const empty = mockDirectory();
  expect(await updateChangelog(empty)).toBe(empty);
  const input = mockDirectory(new Map([["package.json", "{}"]]));
  const output = await updateChangelog(input);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    scripts: { changelog: CHANGELOG_COMMAND },
    devDependencies: { "git-cliff": TOOL_VERSIONS.gitCliff },
  });
  expect(await output.exists("cliff.toml")).toBe(false);
  expect(await output.exists("CHANGELOG.md")).toBe(false);
  const text = JSON.stringify(
    JSON.parse(await output.file("package.json").contents()),
    null,
    4,
  );
  const matching = output.withNewFile("package.json", text);
  expect(await updateChangelog(matching)).toBe(matching);
  expect(await matching.file("package.json").contents()).toBe(text);
});

test.each([
  "{",
  "null",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"devDependencies":"bad"}',
  '{"devDependencies":null}',
])("update rejects an unsafe package without writes: %s", async (contents) => {
  const input = mockDirectory(new Map([["package.json", contents]]));
  await expect(updateChangelog(input)).rejects.toThrow("package.json");
  expect(await input.file("package.json").contents()).toBe(contents);
});

test.each(["library", "forge-app", "tool"])(
  "%s init seeds both files and composed update preserves owner edits and deletion",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      for (const [path, text] of changelogTemplates())
        expect(await initialized.file(path).contents()).toBe(text);
      expect(await module.update(initialized, kind)).toBe(initialized);
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      pkg.scripts.changelog = "owner command";
      pkg.devDependencies["git-cliff"] = "old";
      const edited = initialized
        .withNewFile("package.json", JSON.stringify(pkg))
        .withNewFile("cliff.toml", "# owner policy\n")
        .withNewFile("CHANGELOG.md", "# owner changelog\n");
      const output = await module.update(edited, kind);
      expect(await output.file("cliff.toml").contents()).toBe(
        "# owner policy\n",
      );
      expect(await output.file("CHANGELOG.md").contents()).toBe(
        "# owner changelog\n",
      );
      const updated = JSON.parse(await output.file("package.json").contents());
      expect(updated.scripts.changelog).toBe(CHANGELOG_COMMAND);
      expect(updated.devDependencies["git-cliff"]).toBe(TOOL_VERSIONS.gitCliff);
      expect(await module.update(output, kind)).toBe(output);
      const deleted = output
        .withoutFile("cliff.toml")
        .withoutFile("CHANGELOG.md");
      expect(await module.update(deleted, kind)).toBe(deleted);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("capability validation uses the selected pin and canonical command, leaving owner files untouched", async () => {
  const { commands, spy } = mockContainer({
    "sh -c git rev-list --count HEAD 2>/dev/null || true": "1\n",
    [`sh -c ${CHANGELOG_COMMAND} 2>&1; echo "git-cliff exit=$?"`]:
      "owner rendering\ngit-cliff exit=0",
  });
  const input = mockDirectory(
    new Map([
      ["cliff.toml", '[changelog]\nheader = "Owner heading"\n'],
      ["CHANGELOG.md", "owner output"],
      ["package.json", '{"scripts":{"changelog":"owner command"}}'],
    ]),
  );
  const before = [...input.files];
  try {
    expect(
      await validateCapabilities(input, [changelogToolchain("2.0.0")]),
    ).toEqual([{ capability: "changelog", status: "validated" }]);
    expect(commands[0]?.at(-1)).toBe("git-cliff@2.0.0");
    expect(commands.at(-1)).toEqual([
      "sh",
      "-c",
      `${CHANGELOG_COMMAND} 2>&1; echo "git-cliff exit=$?"`,
    ]);
    expect([...input.files]).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

test("validation skips a repository with no policy", async () => {
  const { spy } = mockContainer({});
  try {
    expect(await validateChangelog(directory(false))).toEqual({
      status: "skipped",
      reason: "cliff.toml is missing",
    });
  } finally {
    spy.mockRestore();
  }
});

test("validation runs the scripted command at the pinned version", async () => {
  const { commands, spy } = mockContainer({
    "sh -c git rev-list --count HEAD 2>/dev/null || true": "42\n",
    [`sh -c ${CHANGELOG_COMMAND} 2>&1; echo "git-cliff exit=$?"`]:
      "## What's Changed\ngit-cliff exit=0",
  });
  try {
    expect(await validateChangelog(directory(true))).toEqual({
      status: "validated",
    });
    expect(commands[0]).toEqual([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `git-cliff@${TOOL_VERSIONS.gitCliff}`,
    ]);
    expect(commands.at(-1)).toEqual([
      "sh",
      "-c",
      `${CHANGELOG_COMMAND} 2>&1; echo "git-cliff exit=$?"`,
    ]);
  } finally {
    spy.mockRestore();
  }
});

test("validation skips a repository with no commits to render", async () => {
  for (const history of ["", "fatal: bad revision 'HEAD'\n"]) {
    const { spy } = mockContainer({
      "sh -c git rev-list --count HEAD 2>/dev/null || true": history,
    });
    try {
      expect(await validateChangelog(directory(true))).toEqual({
        status: "skipped",
        reason: "Git history is unavailable",
      });
    } finally {
      spy.mockRestore();
    }
  }
});

test("validation reports the command's own output when the policy fails", async () => {
  const { spy } = mockContainer({
    "sh -c git rev-list --count HEAD 2>/dev/null || true": "1\n",
    [`sh -c ${CHANGELOG_COMMAND} 2>&1; echo "git-cliff exit=$?"`]:
      "error: invalid type\ngit-cliff exit=1",
  });
  try {
    await expect(validateChangelog(directory(true))).rejects.toThrow(
      /git-cliff validation failed: error: invalid type/,
    );
  } finally {
    spy.mockRestore();
  }
});
