import { afterEach, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildProject } from "../../src/composition/profiles.ts";
import { seedTemplates } from "../../src/core/templates.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

beforeAll(() => {
  const result = spawnSync("git", ["cliff", "--version"], { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout.trim()).toBe(`git-cliff ${TOOL_VERSIONS.gitCliff}`);
});
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function run(cwd: string, command: string, ...args: string[]) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
}
function git(cwd: string, ...args: string[]) {
  const result = run(cwd, "git", ...args);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout.trim();
}
const read = (cwd: string, path: string) =>
  readFileSync(join(cwd, path), "utf8");
const release = (cwd: string, ...args: string[]) =>
  run(cwd, process.execPath, "run", "release", ...args);
async function fixture(kind = "library", checks?: string, initial = false) {
  const scratch = join(import.meta.dir, "../../.scratch");
  mkdirSync(scratch, { recursive: true });
  const root = mkdtempSync(join(scratch, "tmp_rovo_release_"));
  roots.push(root);
  const cwd = join(root, "work");
  const remote = join(root, "remote.git");
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  const project = buildProject(kind, "sample", "tester");
  const source = mockModuleSource();
  try {
    const generated = await seedTemplates(
      mockDirectory(),
      (await import("@dagger.io/dagger")).dag.currentModule().source(),
      project.templates.filter(
        (template) => template.path === "templates/release",
      ),
    );
    writeFileSync(
      join(cwd, "scripts/release.sh"),
      await generated.file("scripts/release.sh").contents(),
    );
  } finally {
    source.mockRestore();
  }
  copyFileSync(
    join(import.meta.dir, "../../templates/changelog/cliff.toml"),
    join(cwd, "cliff.toml"),
  );
  writeFileSync(join(cwd, ".gitignore"), "dist/\n");
  writeFileSync(join(cwd, "source.ts"), "export const value = 1;\n");
  writeFileSync(join(cwd, "CHANGELOG.md"), "# Old notes\n");
  const manager = ["tool", "agent-skill"].includes(kind) ? "bun" : "npm";
  writeFileSync(
    join(cwd, "package.json"),
    JSON.stringify(
      {
        name: "fixture",
        version: "0.1.0",
        private: true,
        scripts: {
          release: project.packageJson.scripts.release,
          "release:check":
            checks ?? project.packageJson.scripts["release:check"],
          test: "echo checked-test",
          typecheck: "echo checked-typecheck",
          ...(kind === "library" ? { "pack:check": "echo checked-pack" } : {}),
          prepublishOnly: "exit 99",
          publish: "exit 99",
          prepare: "exit 99",
          preversion: "exit 99",
          version: "exit 99",
          postversion: "exit 99",
        },
      },
      null,
      2,
    ),
  );
  if (manager === "npm")
    writeFileSync(
      join(cwd, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        version: "0.1.0",
        lockfileVersion: 3,
        packages: {
          "": { name: "fixture", version: "0.1.0" },
          "node_modules/example": { version: "1.2.3", integrity: "unchanged" },
        },
      }),
    );
  else
    writeFileSync(
      join(cwd, "bun.lock"),
      '{\n "lockfileVersion": 1,\n "workspaces": {"": {"name": "fixture",},},\n "packages": {},\n}\n',
    );
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "tag.gpgsign", "false");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initial package");
  if (!initial) {
    git(cwd, "tag", "v0.1.0");
    git(cwd, "commit", "--allow-empty", "-m", "feat!: new contract");
  }
  git(root, "init", "--bare", remote);
  git(cwd, "remote", "add", "origin", remote);
  git(cwd, "push", "--set-upstream", "origin", "main", "--tags");
  return { cwd, remote };
}
function expectUnreleased(cwd: string, remote: string, head: string) {
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(
    head,
  );
  expect(git(cwd, "tag", "--list", "v0.2.0")).toBe("");
}

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s releases main to origin with scaffolded metadata commands",
  async (kind) => {
    const { cwd, remote } = await fixture(kind);
    const cliff = read(cwd, "cliff.toml");
    const lock = existsSync(join(cwd, "bun.lock"))
      ? read(cwd, "bun.lock")
      : undefined;
    const result = release(cwd);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const head = git(cwd, "rev-parse", "HEAD");
    expect(
      git(cwd, "--git-dir", remote, "rev-parse", "refs/tags/v0.2.0^{commit}"),
    ).toBe(head);
    expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(
      head,
    );
    expect(JSON.parse(read(cwd, "package.json")).version).toBe("0.2.0");
    expect(result.stdout).toContain("checked-test");
    expect(result.stdout).toContain("checked-typecheck");
    expect(result.stdout.includes("checked-pack")).toBe(kind === "library");
    expect(read(cwd, "cliff.toml")).toBe(cliff);
    if (lock) expect(read(cwd, "bun.lock")).toBe(lock);
    else {
      const updated = JSON.parse(read(cwd, "package-lock.json"));
      expect(updated.version).toBe("0.2.0");
      expect(updated.packages[""].version).toBe("0.2.0");
      expect(updated.packages["node_modules/example"]).toEqual({
        version: "1.2.3",
        integrity: "unchanged",
      });
    }
    expect(git(cwd, "status", "--porcelain")).toBe("");
    expect(
      git(cwd, "show", "--pretty=", "--name-only", "HEAD").split("\n").sort(),
    ).toEqual(
      [
        "CHANGELOG.md",
        "package.json",
        ...(lock ? [] : ["package-lock.json"]),
      ].sort(),
    );
  },
);
test("first release may use the seeded version", async () => {
  const { cwd } = await fixture("library", undefined, true);
  const result = release(cwd);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(read(cwd, "package.json")).version).toBe("0.1.0");
});
test("successive releases keep history and one changelog header", async () => {
  const { cwd } = await fixture();
  expect(release(cwd).status).toBe(0);
  git(cwd, "commit", "--allow-empty", "-m", "fix: second change");
  git(cwd, "push");
  const result = release(cwd);
  expect(result.status, result.stderr).toBe(0);
  const notes = read(cwd, "CHANGELOG.md");
  expect(notes.match(/# Changelog/g)).toHaveLength(1);
  expect(notes).toContain("0.2.0");
  expect(notes).toContain("0.2.1");
});
test.each(["untracked", "unstaged", "staged", "other branch", "arguments"])(
  "rejects %s before changing release files",
  async (state) => {
    const { cwd, remote } = await fixture();
    const head = git(cwd, "rev-parse", "HEAD");
    const pkg = read(cwd, "package.json");
    if (state === "untracked") writeFileSync(join(cwd, "extra"), "owner");
    if (["unstaged", "staged"].includes(state)) {
      writeFileSync(join(cwd, "source.ts"), "owner edit");
      if (state === "staged") git(cwd, "add", "source.ts");
    }
    if (state === "other branch") git(cwd, "switch", "-c", "feature");
    const result =
      state === "arguments" ? release(cwd, "--remote", "other") : release(cwd);
    expect(result.status).not.toBe(0);
    expectUnreleased(cwd, remote, head);
    expect(read(cwd, "package.json")).toBe(pkg);
  },
);
test.each(["exit 7", "echo changed >> source.ts", "touch extra"])(
  "checks stop release before metadata writes: %s",
  async (check) => {
    const { cwd, remote } = await fixture("library", check);
    const head = git(cwd, "rev-parse", "HEAD");
    const pkg = read(cwd, "package.json");
    const notes = read(cwd, "CHANGELOG.md");
    expect(release(cwd).status).not.toBe(0);
    expectUnreleased(cwd, remote, head);
    expect(read(cwd, "package.json")).toBe(pkg);
    expect(read(cwd, "CHANGELOG.md")).toBe(notes);
  },
);
test("commit hook failure stops before tagging or pushing", async () => {
  const { cwd, remote } = await fixture();
  const head = git(cwd, "rev-parse", "HEAD");
  const path = join(cwd, ".git/hooks/pre-commit");
  writeFileSync(path, "#!/bin/sh\nexit 1\n");
  chmodSync(path, 0o755);
  expect(release(cwd).status).not.toBe(0);
  expectUnreleased(cwd, remote, head);
  expect(git(cwd, "status", "--porcelain")).not.toBe("");
});
test("atomic rejection leaves remote unchanged and local artifacts for inspection", async () => {
  const { cwd, remote } = await fixture();
  const head = git(cwd, "rev-parse", "HEAD");
  const path = join(remote, "hooks/update");
  writeFileSync(path, '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\n');
  chmodSync(path, 0o755);
  expect(release(cwd).status).not.toBe(0);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/main")).toBe(
    head,
  );
  expect(git(cwd, "--git-dir", remote, "tag", "--list", "v0.2.0")).toBe("");
  expect(git(cwd, "tag", "--list", "v0.2.0")).toBe("v0.2.0");
});
