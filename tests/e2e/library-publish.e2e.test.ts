import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildProject } from "../../src/composition/profiles.ts";

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
function fixture(manager = "npm", overrides: Record<string, string> = {}) {
  const root = mkdtempSync(
    join(import.meta.dir, "../../.scratch/tmp_rovo_publish-"),
  );
  roots.push(root);
  const cwd = join(root, "work");
  const remote = join(root, "remote.git");
  mkdirSync(join(cwd, "scripts"), { recursive: true });
  for (const name of ["release-prepare.ts", "release-publish.ts"]) {
    const source = join(
      import.meta.dir,
      "../../templates/library-release/scripts",
      name,
    );
    if (Bun.file(source).size) copyFileSync(source, join(cwd, "scripts", name));
  }
  copyFileSync(
    join(import.meta.dir, "../../templates/changelog/cliff.toml"),
    join(cwd, "cliff.toml"),
  );
  writeFileSync(join(cwd, ".gitignore"), "dist/\n");
  writeFileSync(join(cwd, "source.ts"), "export const value = 1;\n");
  writeFileSync(join(cwd, "CHANGELOG.md"), "# Old notes\n");
  const pkg = {
    name: "fixture",
    version: "0.1.0",
    private: true,
    packageManager: `${manager}@1.0.0`,
    scripts: {
      ...buildProject("library", "sample", "tester").packageJson.scripts,
      test: "echo checked-test",
      typecheck: "echo checked-typecheck",
      "pack:check": "echo checked-pack",
      prepublishOnly: "exit 99",
      publish: "exit 99",
      prepare: "exit 99",
      ...overrides,
    },
  };
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg, null, 2));
  if (manager === "npm")
    writeFileSync(
      join(cwd, "package-lock.json"),
      JSON.stringify({
        name: "fixture",
        version: "0.1.0",
        lockfileVersion: 3,
        packages: { "": { name: "fixture", version: "0.1.0" } },
      }),
    );
  else
    writeFileSync(
      join(cwd, "bun.lock"),
      JSON.stringify({
        lockfileVersion: 1,
        workspaces: { "": { name: "fixture" } },
        packages: {},
      }),
    );
  git(cwd, "init", "--initial-branch=stable");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initial package");
  git(cwd, "tag", "v0.1.0");
  git(cwd, "commit", "--allow-empty", "-m", "feat: new feature");
  git(root, "init", "--bare", remote);
  git(cwd, "remote", "add", "releases", remote);
  git(cwd, "push", "releases", "stable", "--tags");
  const prepared = run(cwd, process.execPath, "run", "release:prepare");
  expect(prepared.status, prepared.stdout + prepared.stderr).toBe(0);
  return { cwd, remote };
}
const publish = (cwd: string, ...args: string[]) =>
  run(cwd, process.execPath, "run", "release:publish", ...args);
const read = (cwd: string, path: string) =>
  readFileSync(join(cwd, path), "utf8");

test("publication uses the sole push URL, not the remote fetch URL", () => {
  const { cwd, remote } = fixture();
  git(cwd, "remote", "set-url", "releases", join(cwd, "nonexistent-fetch.git"));
  git(cwd, "remote", "set-url", "--push", "releases", remote);
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/tags/v0.2.0")).toBe(
    git(cwd, "rev-parse", "HEAD"),
  );
});

test.each(["package.json", "package-lock.json", "cliff.toml", "bun.lock"])(
  "publication rejects changed prepared %s without writing Git",
  (path) => {
    const { cwd } = fixture(path === "bun.lock" ? "bun" : "npm");
    const head = git(cwd, "rev-parse", "HEAD");
    const index = git(cwd, "write-tree");
    writeFileSync(join(cwd, path), `${read(cwd, path)}\nchanged`);
    const result = publish(cwd, "--remote", "releases", "--branch", "stable");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`${path} differs from preparation`);
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "write-tree")).toBe(index);
  },
);

test.each(["untracked", "unstaged", "deleted", "missing-receipt"])(
  "publication refuses %s work before checks",
  (scenario) => {
    const { cwd } = fixture();
    const head = git(cwd, "rev-parse", "HEAD");
    const index = git(cwd, "write-tree");
    if (scenario === "untracked")
      writeFileSync(join(cwd, "new.txt"), "unrelated");
    if (scenario === "unstaged")
      writeFileSync(join(cwd, "source.ts"), "unrelated");
    if (scenario === "deleted") rmSync(join(cwd, "source.ts"));
    if (scenario === "missing-receipt")
      rmSync(
        join(
          cwd,
          git(cwd, "rev-parse", "--git-path", "drop-calf-release.json"),
        ),
      );
    const result = publish(cwd, "--remote", "releases", "--branch", "stable");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      scenario === "missing-receipt" ? "No preparation receipt" : "Unrelated",
    );
    expect(result.stdout).not.toContain("checked-test");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "write-tree")).toBe(index);
  },
);

test("a commit hook cannot smuggle unrelated files into the release commit", () => {
  const { cwd, remote } = fixture();
  const base = git(cwd, "rev-parse", "HEAD");
  const hook = join(cwd, ".git/hooks/pre-commit");
  writeFileSync(
    hook,
    "#!/bin/sh\necho changed >> source.ts\ngit add source.ts\n",
  );
  chmodSync(hook, 0o755);
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain("commit differs");
  expect(result.stderr).toContain("No automatic rollback");
  expect(git(cwd, "tag", "--list", "v0.2.0")).toBe("");
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable")).toBe(
    base,
  );
});

test("remote changes made during checks are detected before staging", () => {
  const { cwd } = fixture("npm", {
    "pack:check": "git push releases HEAD:refs/tags/v0.2.0",
  });
  const base = git(cwd, "rev-parse", "HEAD");
  const index = git(cwd, "write-tree");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain("already exists remotely");
  expect(git(cwd, "rev-parse", "HEAD")).toBe(base);
  expect(git(cwd, "write-tree")).toBe(index);
});

test("unrelated staged edits inside a release file are not silently overwritten", () => {
  const { cwd } = fixture();
  const prepared = read(cwd, "package.json");
  const pkg = JSON.parse(prepared);
  pkg.description = "unrelated staged edit";
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  git(cwd, "add", "package.json");
  writeFileSync(join(cwd, "package.json"), prepared);
  const index = git(cwd, "write-tree");
  const head = git(cwd, "rev-parse", "HEAD");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain("Staged package.json differs");
  expect(git(cwd, "write-tree")).toBe(index);
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
});

test.each(["reject-tag", "no-atomic", "commit-hook"])(
  "partial failure %s preserves evidence and explains recovery",
  (scenario) => {
    const { cwd, remote } = fixture();
    const base = git(cwd, "rev-parse", "HEAD");
    if (scenario === "reject-tag") {
      const hook = join(remote, "hooks/update");
      writeFileSync(
        hook,
        '#!/bin/sh\ncase "$1" in refs/tags/*) echo tag-rejected >&2; exit 1;; esac\n',
      );
      chmodSync(hook, 0o755);
    }
    if (scenario === "no-atomic")
      git(
        cwd,
        "--git-dir",
        remote,
        "config",
        "receive.advertiseAtomic",
        "false",
      );
    if (scenario === "commit-hook") {
      const hook = join(cwd, ".git/hooks/pre-commit");
      writeFileSync(hook, "#!/bin/sh\necho commit-rejected >&2\nexit 1\n");
      chmodSync(hook, 0o755);
    }
    const result = publish(cwd, "--remote", "releases", "--branch", "stable");
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stdout).not.toContain("Published");
    expect(result.stderr).toContain("No automatic rollback");
    expect(
      git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable"),
    ).toBe(base);
    expect(git(cwd, "--git-dir", remote, "tag", "--list", "v0.2.0")).toBe("");
    if (scenario === "commit-hook") {
      expect(git(cwd, "rev-parse", "HEAD")).toBe(base);
      expect(git(cwd, "diff", "--cached", "--name-only").split("\n")).toEqual([
        "CHANGELOG.md",
        "package-lock.json",
        "package.json",
      ]);
    } else {
      const released = git(cwd, "rev-parse", "HEAD");
      expect(released).not.toBe(base);
      expect(git(cwd, "rev-parse", "refs/tags/v0.2.0")).toBe(released);
      expect(git(cwd, "status", "--porcelain")).toBe("");
      const retry = publish(cwd, "--remote", "releases", "--branch", "stable");
      expect(retry.status).not.toBe(0);
      expect(git(cwd, "rev-parse", "HEAD")).toBe(released);
    }
  },
);

test.each(["failure", "missing", "dirty", "metadata", "head"])(
  "release check %s stops publication before helper Git writes",
  (scenario) => {
    const scripts: Record<string, string> = {
      failure: "echo package-check-failed >&2; exit 7",
      missing: "",
      dirty: "echo changed >> source.ts",
      metadata: "echo changed >> CHANGELOG.md",
      head: "git commit --allow-empty -m 'chore: check wrote a commit'",
    };
    const { cwd, remote } = fixture("npm", {
      "pack:check": scripts[scenario] ?? "",
    });
    const head = git(cwd, "rev-parse", "HEAD");
    const index = git(cwd, "write-tree");
    const result = publish(cwd, "--remote", "releases", "--branch", "stable");
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    const messages: Record<string, string> = {
      failure: "package-check-failed",
      missing: "pack:check",
      dirty: "Unrelated",
      metadata: "differs from preparation",
      head: "HEAD differs",
    };
    expect(result.stderr).toContain(messages[scenario] ?? scenario);
    if (scenario !== "head") expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "write-tree")).toBe(index);
    expect(git(cwd, "tag", "--list", "v0.2.0")).toBe("");
    expect(
      git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable"),
    ).toBe(head);
  },
);

test("Bun release keeps its versionless lock unchanged and publishes only release outputs", () => {
  const { cwd, remote } = fixture("bun");
  const lock = read(cwd, "bun.lock");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(read(cwd, "bun.lock")).toBe(lock);
  expect(
    git(cwd, "show", "--format=", "--name-only", "HEAD").split("\n"),
  ).toEqual(["CHANGELOG.md", "package.json"]);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/tags/v0.2.0")).toBe(
    git(cwd, "rev-parse", "HEAD"),
  );
});

type Fixture = ReturnType<typeof fixture>;

/** One way a publication can be refused before it touches Git. */
type Rejection = {
  /** Put the repository into the rejected state. */
  setup?: (fixture: Fixture) => void;
  /** Overrides the destination arguments; `[]` omits them entirely. */
  args?: string[];
  /** Run from `scripts/` instead of the repository root. */
  fromSubdirectory?: boolean;
  /** Text the refusal must mention. */
  diagnostic: string;
};

const DESTINATION = ["--remote", "releases", "--branch", "stable"];

const REJECTIONS: Record<string, Rejection> = {
  detached: {
    setup: ({ cwd }) => git(cwd, "switch", "--detach"),
    diagnostic: "branch",
  },
  "wrong-branch": {
    args: ["--remote", "releases", "--branch", "other"],
    diagnostic: "branch",
  },
  "missing-destination": { args: [], diagnostic: "--remote" },
  "unknown-remote": {
    args: ["--remote", "missing", "--branch", "stable"],
    diagnostic: "remote",
  },
  "remote-ahead": {
    setup: ({ cwd, remote }) =>
      git(
        cwd,
        "--git-dir",
        remote,
        "update-ref",
        "refs/heads/stable",
        git(cwd, "rev-parse", "HEAD^"),
      ),
    diagnostic: "Remote branch",
  },
  "local-tag": {
    setup: ({ cwd }) => git(cwd, "tag", "v0.2.0"),
    diagnostic: "already exists",
  },
  "remote-tag": {
    setup: ({ cwd }) => git(cwd, "push", "releases", "HEAD:refs/tags/v0.2.0"),
    diagnostic: "already exists",
  },
  "multiple-push-urls": {
    setup: ({ cwd, remote }) => {
      git(cwd, "config", "--add", "remote.releases.pushurl", remote);
      git(cwd, "config", "--add", "remote.releases.pushurl", remote);
    },
    diagnostic: "one push",
  },
  merge: {
    setup: ({ cwd }) =>
      writeFileSync(
        join(cwd, ".git/MERGE_HEAD"),
        `${git(cwd, "rev-parse", "HEAD")}\n`,
      ),
    diagnostic: "in progress",
  },
  shallow: {
    setup: ({ cwd }) =>
      writeFileSync(
        join(cwd, ".git/shallow"),
        `${git(cwd, "rev-parse", "HEAD")}\n`,
      ),
    diagnostic: "complete",
  },
  subdirectory: { fromSubdirectory: true, diagnostic: "repository root" },
};

test.each(Object.keys(REJECTIONS))(
  "publication preflight rejects %s without Git writes",
  (scenario) => {
    const rejection = REJECTIONS[scenario];
    if (!rejection) throw new Error(`Unknown scenario ${scenario}`);
    const state = fixture();
    const { cwd, remote } = state;
    rejection.setup?.(state);
    const args = rejection.args ?? DESTINATION;
    const head = git(cwd, "rev-parse", "HEAD");
    const index = git(cwd, "write-tree");
    const refs = git(cwd, "--git-dir", remote, "show-ref");
    const result = rejection.fromSubdirectory
      ? run(
          join(cwd, "scripts"),
          process.execPath,
          "run",
          "release-publish.ts",
          ...args,
        )
      : publish(cwd, ...args);
    expect(
      result.status,
      `${scenario}: ${result.stdout}${result.stderr}`,
    ).not.toBe(0);
    expect(result.stderr).toContain(rejection.diagnostic);
    expect(result.stdout).not.toContain("checked-test");
    expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
    expect(git(cwd, "write-tree")).toBe(index);
    expect(git(cwd, "--git-dir", remote, "show-ref")).toBe(refs);
  },
);

test("publication rejects release notes changed after preparation", () => {
  const { cwd } = fixture();
  const head = git(cwd, "rev-parse", "HEAD");
  writeFileSync(join(cwd, "CHANGELOG.md"), "# Notes for the wrong release\n");
  const index = git(cwd, "write-tree");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain("CHANGELOG.md differs from preparation");
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(git(cwd, "write-tree")).toBe(index);
});

test("unrelated staged work is rejected before checks or Git writes", () => {
  const { cwd, remote } = fixture();
  writeFileSync(join(cwd, "source.ts"), "unrelated edit\n");
  git(cwd, "add", "source.ts");
  const before = git(cwd, "write-tree");
  const head = git(cwd, "rev-parse", "HEAD");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stderr).toContain("Unrelated");
  expect(result.stdout).not.toContain("checked-test");
  expect(git(cwd, "write-tree")).toBe(before);
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable")).toBe(
    head,
  );
});

test("explicit publication checks and pushes only a prepared release to the named branch and remote", () => {
  const { cwd, remote } = fixture();
  const base = git(cwd, "rev-parse", "HEAD");
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable")).toBe(
    base,
  );
  expect(git(cwd, "tag", "--list", "v0.2.0")).toBe("");
  git(cwd, "add", "package.json");
  const result = publish(cwd, "--remote", "releases", "--branch", "stable");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  const released = git(cwd, "rev-parse", "HEAD");
  expect(released).not.toBe(base);
  expect(git(cwd, "log", "-1", "--format=%s")).toBe(
    "chore(release): prepare for v0.2.0",
  );
  expect(
    git(cwd, "show", "--format=", "--name-only", "HEAD").split("\n"),
  ).toEqual(["CHANGELOG.md", "package-lock.json", "package.json"]);
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/heads/stable")).toBe(
    released,
  );
  expect(git(cwd, "--git-dir", remote, "rev-parse", "refs/tags/v0.2.0")).toBe(
    released,
  );
  expect(git(cwd, "status", "--porcelain")).toBe("");
  expect(JSON.parse(read(cwd, "package.json")).private).toBe(true);
  expect(result.stdout).toContain("Published");
});
