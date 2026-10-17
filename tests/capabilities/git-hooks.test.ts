import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  GIT_HOOKS_SCRIPTS,
  GIT_HOOKS_TEMPLATE,
  gitHooks,
} from "../../src/capabilities/git-hooks.ts";
import { LINT_COMMAND } from "../../src/capabilities/lint.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import {
  updateCapabilities,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit, verb } from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { gitHooksTemplates } from "../support/templates-source.ts";

test.each([false, true])(
  "init and update enforce only the selected pin and hook dispatch scripts (buildOnPrepare=%s)",
  async (buildOnPrepare) => {
    const capability = gitHooks({ buildOnPrepare });
    const scripts = {
      ...GIT_HOOKS_SCRIPTS,
      prepare: buildOnPrepare
        ? "npm run build && (lefthook install || true)"
        : "lefthook install || true",
    };
    const project = createBlueprint("sample", "", "tester");
    if (typeof capability.init !== "function") throw new Error("missing init");
    runInit(capability, project);
    expect(project.templates.map((template) => template.path)).toEqual([
      GIT_HOOKS_TEMPLATE,
    ]);
    expect(project.packageJson.devDependencies.lefthook).toBe(
      TOOL_VERSIONS.lefthook,
    );
    expect(project.packageJson.scripts).toEqual(scripts);
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
            devDependencies: { lefthook: "0.0.1", custom: "1" },
            dependencies: { keep: "1" },
          }),
        ],
        ["lefthook.yml", "owner content, even invalid\r\n"],
        ["bun.lock", "owner lock"],
      ]),
    );
    const before = [...input.files];
    const execution = spyOn(dag, "container").mockImplementation(() => {
      throw new Error("git-hooks update must not execute tools");
    });
    let output: typeof input;
    try {
      output = (await updateCapabilities(input, [capability])) as typeof input;
      expect(execution).not.toHaveBeenCalled();
    } finally {
      execution.mockRestore();
    }
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      name: "owner",
      scripts: { ...scripts, lint: "owner", custom: "keep" },
      devDependencies: { lefthook: TOOL_VERSIONS.lefthook, custom: "1" },
      dependencies: { keep: "1" },
    });
    for (const [path, text] of input.files)
      if (path !== "package.json")
        expect(await output.file(path).contents()).toBe(text);
    expect([...input.files]).toEqual(before);
    expect(await updateCapabilities(output, [capability])).toBe(output);
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
      const prepare =
        kind === "library"
          ? "npm run build && (lefthook install || true)"
          : "lefthook install || true";
      expect(pkg.scripts.prepare).toBe(prepare);
      Object.assign(pkg.scripts, {
        prepare: "owner",
        lint: "owner",
        check: "owner",
        custom: "keep",
      });
      pkg.devDependencies.lefthook = "0.0.1";
      const edited = initialized
        .withNewFile("package.json", JSON.stringify(pkg))
        .withNewFile("lefthook.yml", "# owner hooks\n")
        .withNewFile("bun.lock", "owner lock\n")
        .withNewFile(".git", "gitdir: /does-not-exist\n");
      const before = [...(edited as ReturnType<typeof mockDirectory>).files];
      const output = await module.update(edited, kind);
      expect([...(edited as ReturnType<typeof mockDirectory>).files]).toEqual(
        before,
      );
      expect(await output.file("bun.lock").contents()).toBe("owner lock\n");
      expect(await output.file(".git").contents()).toBe(
        "gitdir: /does-not-exist\n",
      );
      expect(await output.file("lefthook.yml").contents()).toBe(
        "# owner hooks\n",
      );
      const updated = JSON.parse(await output.file("package.json").contents());
      expect(updated.scripts).toEqual({
        ...pkg.scripts,
        ...GIT_HOOKS_SCRIPTS,
        lint: LINT_COMMAND,
        prepare,
      });
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

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s git-hooks owns prepare/check and lint owns the aggregate in any composition order",
  (kind) => {
    const capabilities = resolveProfile(kind);
    for (const script of ["prepare", "lint", "check"]) {
      const owners = capabilities.filter((capability) => {
        const project = createBlueprint("sample", "", "tester");
        runInit(capability, project);
        return Object.hasOwn(project.packageJson.scripts, script);
      });
      expect(owners.map((capability) => capability.name)).toEqual([
        script === "lint" ? "lint" : "git-hooks",
      ]);
    }
    const project = createBlueprint("sample", "", "tester");
    for (const capability of [...capabilities].reverse())
      runInit(capability, project);
    expect(project.packageJson.scripts).toEqual(
      buildProject(kind, "sample", "tester").packageJson.scripts,
    );
  },
);

test("validation skips missing lefthook.yml before starting a container", async () => {
  const { commands, spy } = mockContainer();
  try {
    const validate = verb(gitHooks(), "validate");
    expect(await validate(mockDirectory())).toEqual({
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
      const [result] = await validateCapabilities(input, [gitHooks()]);
      expect(result?.status).toBe(status);
      if (result?.status === "failed") expect(result.reason).toContain(report);
      expect(commands).toEqual([
        [
          "npm",
          "install",
          "--global",
          "--no-fund",
          "--no-audit",
          `lefthook@${TOOL_VERSIONS.lefthook}`,
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
    expect(scripts.prepare).toBe(
      kind === "library"
        ? "npm run build && (lefthook install || true)"
        : "lefthook install || true",
    );
    expect(scripts.lint).toBe(LINT_COMMAND);
    expect(scripts.check).toBe("lefthook run pre-push --force");
    const yml = config();
    expect(yml).not.toMatch(/^lint:/m);
    expect(yml).toContain("run: npm run lint --if-present");
    expect(yml).toMatch(/^pre-push:/m);
    expect(yml).toContain("run: npm run size:check --if-present");
    expect(yml).not.toContain("run: npm run size --if-present");
  },
);
