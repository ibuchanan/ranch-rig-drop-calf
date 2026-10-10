import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  CHANGELOG_COMMAND,
  CHANGELOG_TEMPLATE,
  validateChangelog,
} from "../src/changelog.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { changelogTemplates } from "./templates-source.ts";

/** `planSync` seeds the release policy from a template map, like the OSS and docs trees. */
const toolPlan = (files: Map<string, string>) =>
  planSync(
    files,
    "tool",
    "tester",
    undefined,
    [],
    [],
    undefined,
    changelogTemplates(),
  );

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

test("sync seeds the release policy verbatim and converges without changing a custom one", () => {
  const templates = changelogTemplates();
  const first = applySync(
    toolPlan(new Map([["package.json", '{"name":"sample"}']])),
  ).files;
  expect(first.get("cliff.toml")).toBe(templates.get("cliff.toml"));
  expect(toolPlan(first).operations).toEqual([]);

  const custom = "# team's own release policy\n[changelog]\nbody = 'custom'\n";
  const customized = new Map(first);
  customized.set("cliff.toml", custom);
  expect(toolPlan(customized).operations).toEqual([]);
  expect(applySync(toolPlan(customized)).files.get("cliff.toml")).toBe(custom);
});

test("sync leaves agent-skill without a release policy it cannot run", () => {
  const result = applySync(
    planSync(
      new Map([["package.json", '{"name":"sample"}']]),
      "agent-skill",
      "tester",
      undefined,
      [],
      [],
      undefined,
      changelogTemplates(),
    ),
  ).files;
  expect(result.has("cliff.toml")).toBe(false);
});

test("sync rejects a conflicting changelog command without mutating files", () => {
  const original = '{"name":"sample","scripts":{"changelog":"release-it"}}';
  const files = new Map([["package.json", original]]);
  expect(() =>
    planSync(
      files,
      "tool",
      "tester",
      undefined,
      [],
      [],
      undefined,
      changelogTemplates(),
    ),
  ).toThrow(ConflictError);
  expect(files.get("package.json")).toBe(original);
  expect(files.has("cliff.toml")).toBe(false);
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

test("the seeded policy is the module's own, not the example repo's", () => {
  const policy = changelogTemplates().get("cliff.toml") ?? "";
  expect(policy).toContain("# git-cliff ~ configuration file");
  // The preprocessor that strips an Atlassian ticket suffix is what makes the
  // policy specific to how this repository writes commits.
  expect(policy).toContain("^([a-z]+(?:\\([^)]+\\))?!?:) NONE\\s+");
  expect(CHANGELOG_TEMPLATE).toBe("templates/changelog");
});
