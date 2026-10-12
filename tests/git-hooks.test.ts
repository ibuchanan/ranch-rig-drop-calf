import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { updateCapabilities, validateCapabilities } from "../src/capability.ts";
import {
  GIT_HOOKS_SCRIPTS,
  GIT_HOOKS_TEMPLATE,
  gitHooks,
  updateGitHooks,
  validateGitHooks,
} from "../src/git-hooks.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject, resolveProfile } from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { gitHooksTemplates } from "./templates-source.ts";

test("init and update enforce only the selected pin and hook dispatch scripts", async () => {
  const capability = gitHooks("2.1.4");
  const project = createBlueprint("sample", "", "tester");
  if (typeof capability.init !== "function") throw new Error("missing init");
  capability.init(project);
  expect(project.templates.map((template) => template.path)).toEqual([
    GIT_HOOKS_TEMPLATE,
  ]);
  expect(project.packageJson.devDependencies.lefthook).toBe("2.1.4");
  expect(project.packageJson.scripts).toEqual(GIT_HOOKS_SCRIPTS);
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: {
            prepare: "owner",
            lint: "owner",
            check: "owner",
            custom: "keep",
          },
          devDependencies: { lefthook: "old", custom: "1" },
          dependencies: { keep: "1" },
        }),
      ],
      ["lefthook.yml", "owner content, even invalid\r\n"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const output = await updateCapabilities(input, [capability]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    name: "owner",
    scripts: { ...GIT_HOOKS_SCRIPTS, custom: "keep" },
    devDependencies: { lefthook: "2.1.4", custom: "1" },
    dependencies: { keep: "1" },
  });
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await updateCapabilities(output, [capability])).toBe(output);
});

test("update creates missing owned keys but not a missing package or hook config", async () => {
  const empty = mockDirectory();
  expect(await updateGitHooks(empty)).toBe(empty);
  const output = await updateGitHooks(
    mockDirectory(new Map([["package.json", "{}"]])),
  );
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg).toEqual({
    scripts: GIT_HOOKS_SCRIPTS,
    devDependencies: { lefthook: TOOL_VERSIONS.lefthook },
  });
  expect(await output.exists("lefthook.yml")).toBe(false);
  const text = JSON.stringify(pkg, null, 4);
  const matching = output.withNewFile("package.json", text);
  expect(await updateGitHooks(matching)).toBe(matching);
  expect(await matching.file("package.json").contents()).toBe(text);
});

test.each([
  "{",
  "null",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"scripts":"bad"}',
  '{"devDependencies":null}',
  '{"devDependencies":[]}',
])(
  "update rejects unsafe package shape without writes: %s",
  async (contents) => {
    const input = mockDirectory(new Map([["package.json", contents]]));
    await expect(updateGitHooks(input)).rejects.toThrow("package.json");
    expect(await input.file("package.json").contents()).toBe(contents);
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init seeds config and composed update preserves edits and deletion idempotently",
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
      expect(await initialized.file("lefthook.yml").contents()).toBe(config());
      expect(await module.update(initialized, kind)).toBe(initialized);
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      Object.assign(pkg.scripts, {
        prepare: "owner",
        lint: "owner",
        check: "owner",
        custom: "keep",
      });
      pkg.devDependencies.lefthook = "old";
      const edited = initialized
        .withNewFile("package.json", JSON.stringify(pkg))
        .withNewFile("lefthook.yml", "# owner hooks\n");
      const output = await module.update(edited, kind);
      expect(await output.file("lefthook.yml").contents()).toBe(
        "# owner hooks\n",
      );
      const updated = JSON.parse(await output.file("package.json").contents());
      expect(updated.scripts).toEqual({ ...pkg.scripts, ...GIT_HOOKS_SCRIPTS });
      expect(updated.devDependencies.lefthook).toBe(TOOL_VERSIONS.lefthook);
      expect(await module.update(output, kind)).toBe(output);
      const deleted = output.withoutFile("lefthook.yml");
      expect(await module.update(deleted, kind)).toBe(deleted);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("git-hooks is the only capability that contributes lint, regardless of composition order", () => {
  const owners = resolveProfile("forge-app").filter((capability) => {
    const project = createBlueprint("sample", "", "tester");
    if (typeof capability.init === "function") capability.init(project);
    return Object.hasOwn(project.packageJson.scripts, "lint");
  });
  expect(owners.map((capability) => capability.name)).toEqual(["git-hooks"]);
});

test("validation skips missing lefthook.yml before starting a container", async () => {
  const { commands, spy } = mockContainer();
  try {
    expect(await validateGitHooks(mockDirectory())).toEqual({
      status: "skipped",
      reason: "lefthook.yml is missing",
    });
    expect(commands).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

test.each([
  ["owner config accepted\nlefthook exit=0", "validated"],
  ["bad config\nlefthook exit=1", "failed"],
  ["broken diagnostic with no exit marker", "failed"],
] as const)(
  "validation retains Lefthook diagnostic and never runs hooks: %s",
  async (report, status) => {
    const { commands, environment, mounts, mounted, spy } = mockContainer({
      stdout: () => report,
    });
    const input = mockDirectory(
      new Map([
        [
          "lefthook.yml",
          "pre-commit:\n  commands:\n    owner:\n      run: npm run missing\n",
        ],
        [
          "package.json",
          "not even JSON; validation does not inspect npm scripts",
        ],
        [".git/hooks/pre-commit", "owner hook"],
      ]),
    );
    const before = [...input.files];
    try {
      const [result] = await validateCapabilities(input, [gitHooks("2.1.4")]);
      expect(result?.status).toBe(status);
      if (result?.status === "failed") expect(result.reason).toContain(report);
      expect(commands).toEqual([
        [
          "npm",
          "install",
          "--global",
          "--no-fund",
          "--no-audit",
          "lefthook@2.1.4",
        ],
        ["git", "init", "/lefthook-worktree"],
        ["sh", "-c", 'lefthook validate 2>&1; echo "lefthook exit=$?"'],
      ]);
      expect(environment).toEqual({
        GIT_DIR: "/lefthook-worktree/.git",
        GIT_WORK_TREE: "/repo",
      });
      expect(mounts).toEqual([{ path: "/repo" }]);
      expect(mounted).toEqual([input]);
      expect([...input.files]).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  },
);

const hooks = () => gitHooksTemplates();
const config = () => hooks().get("lefthook.yml") ?? "";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s installs Lefthook and points its scripts at the shared config",
  (kind) => {
    const { scripts, devDependencies } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    expect(devDependencies.lefthook).toBe(TOOL_VERSIONS.lefthook);
    expect(scripts.prepare).toBe("lefthook install || true");
    expect(scripts.lint).toBe("lefthook run lint");
    expect(scripts.check).toBe("lefthook run pre-push --force");
    const yml = config();
    // The scripts run these groups by name; what each one runs is the
    // template's call.
    expect(yml).toMatch(/^lint:/m);
    expect(yml).toMatch(/^pre-push:/m);
  },
);
