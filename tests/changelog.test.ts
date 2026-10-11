import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  CHANGELOG_COMMAND,
  CHANGELOG_CONFIG,
  CHANGELOG_TEMPLATE,
  validateChangelog,
} from "../src/changelog.ts";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
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
