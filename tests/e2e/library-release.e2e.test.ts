import { afterEach, beforeAll, expect, test } from "bun:test";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";

beforeAll(() => {
  const result = spawnSync("git", ["cliff", "--version"], { encoding: "utf8" });
  expect(
    result.status,
    `Install git-cliff ${TOOL_VERSIONS.gitCliff} before running release E2E tests: ${result.stderr}`,
  ).toBe(0);
  expect(result.stdout.trim()).toBe(`git-cliff ${TOOL_VERSIONS.gitCliff}`);
});
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildProject } from "../../src/composition/profiles.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const template = join(
  import.meta.dir,
  "../../templates/library-release/scripts/release-prepare.ts",
);
function run(cwd: string, args: [string, ...string[]], env = {}) {
  return spawnSync(args[0], args.slice(1), {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 15000,
  });
}
function git(cwd: string, ...args: string[]) {
  const result = run(cwd, ["git", ...args]);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  return result.stdout.trim();
}
function fixture() {
  const root = join(import.meta.dir, "../../.scratch");
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(join(root, "tmp_rovo_release_"));
  roots.push(cwd);
  mkdirSync(join(cwd, "scripts"));
  if (existsSync(template))
    copyFileSync(template, join(cwd, "scripts/release-prepare.ts"));
  copyFileSync(
    join(import.meta.dir, "../../templates/changelog/cliff.toml"),
    join(cwd, "cliff.toml"),
  );
  const pkg = {
    name: "release-fixture",
    version: "0.1.0",
    packageManager: "npm@10.9.2",
    scripts: {
      "release:prepare": buildProject("library", "sample", "tester").packageJson
        .scripts["release:prepare"],
      prepare: "touch unexpected-lifecycle",
      preversion: "touch unexpected-lifecycle",
      version: "touch unexpected-lifecycle",
      postversion: "touch unexpected-lifecycle",
    },
  };
  writeFileSync(join(cwd, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  writeFileSync(join(cwd, "CHANGELOG.md"), "# Old release notes\n");
  writeFileSync(
    join(cwd, "package-lock.json"),
    JSON.stringify(
      {
        name: pkg.name,
        version: pkg.version,
        lockfileVersion: 3,
        packages: { "": { name: pkg.name, version: pkg.version } },
      },
      null,
      2,
    ),
  );
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "test@example.com");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: initial package");
  git(cwd, "tag", "v0.1.0");
  git(cwd, "commit", "--allow-empty", "-m", "feat!: introduce new contract");
  return cwd;
}
function commit(cwd: string) {
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "chore: fixture configuration");
}
const prepare = (cwd: string, env = {}) =>
  run(cwd, [process.execPath, "run", "release:prepare"], env);
const read = (cwd: string, path: string) =>
  readFileSync(join(cwd, path), "utf8");

test("unsupported or contradictory lockfile evidence fails without changing release files", () => {
  for (const scenario of [
    "multiple",
    "missing",
    "yarn",
    "pnpm",
    "bun-binary",
    "shrinkwrap",
    "manager-mismatch",
    "workspaces",
    "old-lock",
    "stale-lock",
    "malformed-lock",
  ]) {
    const cwd = fixture();
    const pkg = JSON.parse(read(cwd, "package.json"));
    if (scenario === "multiple") writeFileSync(join(cwd, "bun.lock"), "{}");
    if (scenario === "missing") rmSync(join(cwd, "package-lock.json"));
    const unsupported: Record<string, string> = {
      yarn: "yarn.lock",
      pnpm: "pnpm-lock.yaml",
      "bun-binary": "bun.lockb",
      shrinkwrap: "npm-shrinkwrap.json",
    };
    const unsupportedLock = unsupported[scenario];
    if (unsupportedLock)
      writeFileSync(join(cwd, unsupportedLock), "unsupported");
    if (scenario === "manager-mismatch") {
      pkg.packageManager = "bun@1.4.2";
      writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
    }
    if (scenario === "workspaces") {
      pkg.workspaces = ["packages/*"];
      writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
    }
    if (scenario === "old-lock" || scenario === "stale-lock") {
      const lock = JSON.parse(read(cwd, "package-lock.json"));
      if (scenario === "old-lock") lock.lockfileVersion = 99;
      else lock.packages[""].version = "0.0.1";
      writeFileSync(join(cwd, "package-lock.json"), JSON.stringify(lock));
    }
    if (scenario === "malformed-lock")
      writeFileSync(join(cwd, "package-lock.json"), "{");
    commit(cwd);
    const before = git(cwd, "write-tree");
    const result = prepare(cwd);
    expect(
      result.status,
      `${scenario}: ${result.stdout}${result.stderr}`,
    ).not.toBe(0);
    expect(result.stderr).toContain("release:prepare:");
    expect(git(cwd, "status", "--porcelain"), scenario).toBe("");
    expect(git(cwd, "write-tree")).toBe(before);
  }
}, 20000);

test.each([
  "detached",
  "shallow",
  "merge",
  "rebase",
  "missing-policy",
  "no-history",
  "subdirectory",
])("repository preflight rejects %s before mutations", (scenario) => {
  const cwd = fixture();
  if (scenario === "detached") git(cwd, "switch", "--detach");
  if (scenario === "shallow")
    writeFileSync(
      join(cwd, ".git/shallow"),
      `${git(cwd, "rev-parse", "HEAD")}\n`,
    );
  if (scenario === "merge")
    writeFileSync(
      join(cwd, ".git/MERGE_HEAD"),
      `${git(cwd, "rev-parse", "HEAD")}\n`,
    );
  if (scenario === "rebase") mkdirSync(join(cwd, ".git/rebase-merge"));
  if (scenario === "missing-policy") {
    rmSync(join(cwd, "cliff.toml"));
    commit(cwd);
  }
  if (scenario === "no-history") {
    git(cwd, "symbolic-ref", "HEAD", "refs/heads/empty");
  }
  const before = ["package.json", "package-lock.json", "CHANGELOG.md"].map(
    (path) => (existsSync(join(cwd, path)) ? read(cwd, path) : null),
  );
  const result =
    scenario === "subdirectory"
      ? run(join(cwd, "scripts"), [
          process.execPath,
          "run",
          "release-prepare.ts",
        ])
      : prepare(cwd);
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  const diagnostics: Record<string, string> = {
    detached: "branch",
    shallow: "complete",
    merge: "in progress",
    rebase: "in progress",
    "missing-policy": "cliff.toml",
    "no-history": "history",
    subdirectory: "repository root",
  };
  expect(result.stderr).toContain(diagnostics[scenario] ?? scenario);
  expect(
    ["package.json", "package-lock.json", "CHANGELOG.md"].map((path) =>
      existsSync(join(cwd, path)) ? read(cwd, path) : null,
    ),
  ).toEqual(before);
});

test.each([
  "invalid-version",
  "non-advancing",
  "missing-cliff",
  "missing-git",
  "render-failure",
])("tool failure %s preserves release files and its diagnostic", (scenario) => {
  const cwd = fixture();
  const tools = join(cwd, ".git/tools");
  mkdirSync(tools);
  const gitBinary = Bun.which("git");
  if (!gitBinary) throw new Error("Git is required for release tests");
  if (scenario !== "missing-git") symlinkSync(gitBinary, join(tools, "git"));
  if (scenario !== "missing-git" && scenario !== "missing-cliff") {
    const output =
      scenario === "invalid-version"
        ? "v01.2.0"
        : scenario === "non-advancing"
          ? "v0.1.0"
          : "v0.2.0";
    writeFileSync(
      join(tools, "git-cliff"),
      `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = "--bumped-version" ]; then printf '%s\\n' '${output}'; exit 0; fi\ndone\necho deliberate-render-failure >&2\nexit 29\n`,
      { mode: 0o755 },
    );
  }
  const before = ["package.json", "package-lock.json", "CHANGELOG.md"].map(
    (path) => read(cwd, path),
  );
  const result = run(
    cwd,
    [process.execPath, "run", "scripts/release-prepare.ts"],
    { PATH: tools, GIT_EXEC_PATH: tools },
  );
  expect(result.status).not.toBe(0);
  const messages: Record<string, string> = {
    "invalid-version": "Invalid release version",
    "non-advancing": "does not advance",
    "missing-cliff": "cliff",
    "missing-git": "git",
    "render-failure": "deliberate-render-failure",
  };
  expect(result.stderr).toContain(messages[scenario] ?? scenario);
  expect(
    ["package.json", "package-lock.json", "CHANGELOG.md"].map((path) =>
      read(cwd, path),
    ),
  ).toEqual(before);
  expect(git(cwd, "status", "--porcelain")).toBe("");
});

test("an already existing release tag cannot be prepared again even when package metadata lags", () => {
  const cwd = fixture();
  git(cwd, "tag", "v0.2.0");
  const result = prepare(cwd);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("already exists");
  expect(git(cwd, "status", "--porcelain")).toBe("");
});

test("release output paths cannot redirect writes outside the reviewable files", () => {
  const cwd = fixture();
  const target = join(cwd, ".git/protected-output");
  writeFileSync(target, "must remain untouched");
  rmSync(join(cwd, "CHANGELOG.md"));
  symlinkSync(target, join(cwd, "CHANGELOG.md"));
  commit(cwd);
  const before = read(cwd, "package.json");
  const result = prepare(cwd);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("regular");
  expect(readFileSync(target, "utf8")).toBe("must remain untouched");
  expect(read(cwd, "package.json")).toBe(before);
});

test.each([2, 3])(
  "npm lock v%s infers its manager without changing dependency resolutions",
  (lockfileVersion) => {
    const cwd = fixture();
    const pkg = JSON.parse(read(cwd, "package.json"));
    delete pkg.packageManager;
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
    const lock = JSON.parse(read(cwd, "package-lock.json"));
    lock.lockfileVersion = lockfileVersion;
    lock.packages["node_modules/example"] = {
      version: "1.0.0",
      resolved: "https://example.invalid/example.tgz",
      integrity: "sha512-owner",
    };
    writeFileSync(join(cwd, "package-lock.json"), JSON.stringify(lock));
    commit(cwd);
    const result = prepare(cwd);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const updated = JSON.parse(read(cwd, "package-lock.json"));
    expect(updated.packages["node_modules/example"]).toEqual(
      lock.packages["node_modules/example"],
    );
    expect(updated.lockfileVersion).toBe(lockfileVersion);
    expect(updated.version).toBe("0.2.0");
    expect(updated.packages[""].version).toBe("0.2.0");
  },
);

test.each(["patch", "initial", "bare-tag"])(
  "git-cliff determines the %s release from available tags and commits",
  (scenario) => {
    const cwd = fixture();
    git(cwd, "reset", "--hard", "v0.1.0");
    if (scenario === "initial") {
      git(cwd, "tag", "--delete", "v0.1.0");
      const pkg = JSON.parse(read(cwd, "package.json"));
      pkg.version = "0.0.0";
      writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
      const lock = JSON.parse(read(cwd, "package-lock.json"));
      lock.version = "0.0.0";
      lock.packages[""].version = "0.0.0";
      writeFileSync(join(cwd, "package-lock.json"), JSON.stringify(lock));
      commit(cwd);
    }
    if (scenario === "bare-tag") {
      git(cwd, "tag", "--delete", "v0.1.0");
      git(cwd, "tag", "0.1.0");
    }
    git(cwd, "commit", "--allow-empty", "-m", "fix: correct return value");
    const result = prepare(cwd);
    expect(result.status, result.stdout + result.stderr).toBe(0);
    const version = scenario === "initial" ? "0.1.0" : "0.1.1";
    expect(JSON.parse(read(cwd, "package.json")).version).toBe(version);
    expect(read(cwd, "CHANGELOG.md")).toContain(`## [${version}]`);
  },
);

test("owner bump and tag policy controls both the chosen version and rendered release", () => {
  const cwd = fixture();
  writeFileSync(
    join(cwd, "cliff.toml"),
    read(cwd, "cliff.toml").replace(
      "breaking_always_bump_major = false",
      "breaking_always_bump_major = true",
    ),
  );
  commit(cwd);
  const result = prepare(cwd);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(read(cwd, "package.json")).version).toBe("1.0.0");
  expect(read(cwd, "CHANGELOG.md")).toContain("## [1.0.0]");
  expect(read(cwd, "CHANGELOG.md").match(/# Changelog/g)).toHaveLength(1);
  expect(read(cwd, "cliff.toml")).toContain(
    "breaking_always_bump_major = true",
  );
});

test("Bun preparation preserves its versionless text lock and does not create npm locks or run installation", () => {
  const cwd = fixture();
  const pkg = JSON.parse(read(cwd, "package.json"));
  pkg.packageManager = "bun@1.4.2";
  pkg.dependencies = { "local-dependency": "file:./local-dependency" };
  mkdirSync(join(cwd, "local-dependency"));
  writeFileSync(
    join(cwd, "local-dependency/package.json"),
    '{"name":"local-dependency","version":"1.0.0"}',
  );
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  writeFileSync(join(cwd, ".gitignore"), "node_modules\n");
  rmSync(join(cwd, "package-lock.json"));
  const installed = run(cwd, [
    process.execPath,
    "install",
    "--lockfile-only",
    "--ignore-scripts",
    "--offline",
  ]);
  expect(installed.status, installed.stdout + installed.stderr).toBe(0);
  const lock = read(cwd, "bun.lock");
  commit(cwd);
  const result = prepare(cwd);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(read(cwd, "package.json")).version).toBe("0.2.0");
  expect(read(cwd, "bun.lock")).toBe(lock);
  expect(existsSync(join(cwd, "package-lock.json"))).toBe(false);
  expect(existsSync(join(cwd, "node_modules"))).toBe(false);
  expect(existsSync(join(cwd, "unexpected-lifecycle"))).toBe(false);
  const frozen = run(cwd, [
    process.execPath,
    "install",
    "--lockfile-only",
    "--ignore-scripts",
    "--offline",
    "--frozen-lockfile",
  ]);
  expect(frozen.status, frozen.stdout + frozen.stderr).toBe(0);
  expect(read(cwd, "bun.lock")).toBe(lock);
});

test("rerunning preparation refuses a dirty tree and cannot advance again after the prepared files are committed", () => {
  const cwd = fixture();
  expect(prepare(cwd).status).toBe(0);
  const files = ["package.json", "package-lock.json", "CHANGELOG.md"].map(
    (path) => read(cwd, path),
  );
  const rerun = prepare(cwd);
  expect(rerun.status).not.toBe(0);
  expect(rerun.stderr).toContain("clean working tree");
  expect(
    ["package.json", "package-lock.json", "CHANGELOG.md"].map((path) =>
      read(cwd, path),
    ),
  ).toEqual(files);
  commit(cwd);
  const committed = prepare(cwd);
  expect(committed.status).not.toBe(0);
  expect(committed.stderr).toContain("does not advance");
  expect(git(cwd, "status", "--porcelain")).toBe("");
  expect(
    ["package.json", "package-lock.json", "CHANGELOG.md"].map((path) =>
      read(cwd, path),
    ),
  ).toEqual(files);
});

test("prepare derives the 0.x breaking release from cliff policy, synchronizes npm metadata, and leaves Git untouched", () => {
  const cwd = fixture();
  const head = git(cwd, "rev-parse", "HEAD");
  const refs = git(cwd, "show-ref");
  const index = git(cwd, "write-tree");
  const result = prepare(cwd);
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(JSON.parse(read(cwd, "package.json")).version).toBe("0.2.0");
  const lock = JSON.parse(read(cwd, "package-lock.json"));
  expect(lock.version).toBe("0.2.0");
  expect(lock.packages[""].version).toBe("0.2.0");
  expect(read(cwd, "CHANGELOG.md")).toContain("## [0.2.0]");
  expect(read(cwd, "CHANGELOG.md")).toContain("Introduce new contract");
  expect(read(cwd, "CHANGELOG.md")).not.toContain("Old release notes");
  expect(git(cwd, "rev-parse", "HEAD")).toBe(head);
  expect(git(cwd, "show-ref")).toBe(refs);
  expect(git(cwd, "write-tree")).toBe(index);
  expect(existsSync(join(cwd, "unexpected-lifecycle"))).toBe(false);
  expect(result.stdout).toContain("review");
});
