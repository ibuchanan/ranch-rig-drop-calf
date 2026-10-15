import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { scaffoldName } from "../src/core/package-json.ts";
import {
  checkStagedFiles,
  git,
  type RepositoryResult,
} from "../src/repository-git.ts";

function optionalGit(directory: string, ...args: string[]): string | undefined {
  try {
    return git(directory, ...args);
  } catch {
    return undefined;
  }
}

/** Snapshot all source, including ignored files, without reading .git or dependency trees. */
export function sourceFingerprint(directory: string): string {
  const hash = createHash("sha256");
  function visit(relative: string): void {
    for (const entry of readdirSync(join(directory, relative)).sort()) {
      if ([".git", "node_modules", ".scratch"].includes(entry)) continue;
      const path = join(relative, entry),
        absolute = join(directory, path),
        stat = lstatSync(absolute);
      hash.update(JSON.stringify([path, stat.mode]));
      if (stat.isSymbolicLink()) hash.update(readlinkSync(absolute));
      else if (stat.isDirectory()) visit(path);
      else if (stat.isFile()) hash.update(readFileSync(absolute));
      else throw new Error(`Unsupported source file: ${path}`);
    }
  }
  visit("");
  return hash.digest("hex");
}

export function inspectCheckout(directory: string): {
  branch?: string;
  head?: string;
} {
  const top = optionalGit(directory, "rev-parse", "--show-toplevel");
  if (top && realpathSync(top) !== realpathSync(directory))
    throw new Error(
      "Run at the repository root; refusing a nested or parent repository.",
    );
  if (!top) {
    if (existsSync(join(directory, ".git")))
      throw new Error(
        "Unusable .git metadata; repair it before running Drop Calf.",
      );
    return {};
  }
  const branch = optionalGit(directory, "symbolic-ref", "--short", "HEAD");
  if (!branch) throw new Error("Detached HEAD: select a target branch first.");
  for (const marker of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "BISECT_START",
  ]) {
    const path = git(directory, "rev-parse", "--git-path", marker);
    if (existsSync(resolve(directory, path)))
      throw new Error(`Git operation in progress: ${marker}`);
  }
  const head = optionalGit(directory, "rev-parse", "--verify", "HEAD");
  if (!head && git(directory, "diff", "--cached", "--name-only"))
    throw new Error(
      "Unborn repository has staged changes; unstage them before init.",
    );
  if (head && git(directory, "status", "--porcelain"))
    throw new Error(
      "Commit or remove staged, unstaged, and untracked changes first.",
    );
  if (
    head &&
    git(directory, "rev-parse", "--is-shallow-repository") !== "false"
  )
    throw new Error("Full Git history is required.");
  return { branch, head };
}

/** Import objects first, then advance the checkout only if its original state still matches. */
export function deliverRepository(
  directory: string,
  artifacts: string,
  expected: { branch: string; head?: string; fingerprint: string },
): RepositoryResult {
  const result: RepositoryResult = JSON.parse(
    readFileSync(join(artifacts, "result.json"), "utf8"),
  );
  if (result.status === "failed")
    throw new Error(
      `${result.error}; recovery artifacts retained at ${artifacts}`,
    );
  const now = inspectCheckout(directory);
  if (
    now.head !== expected.head ||
    (now.branch && now.branch !== expected.branch) ||
    sourceFingerprint(directory) !== expected.fingerprint
  )
    throw new Error(
      `Checkout changed during generation; recovery artifacts retained at ${artifacts}`,
    );
  if (
    result.targetBranch !== expected.branch ||
    (expected.head && result.base !== expected.head)
  )
    throw new Error("Result does not match the captured repository base.");
  if (result.status === "unchanged") return result;
  if (!existsSync(join(directory, ".git")))
    git(directory, "init", "--initial-branch", expected.branch, ".");
  const bundle = resolve(artifacts, "repository.bundle");
  git(directory, "bundle", "verify", bundle);
  // Fetch objects only: the existing repository's remote configuration is untouched.
  git(
    directory,
    "fetch",
    "--no-write-fetch-head",
    bundle,
    `refs/heads/${expected.branch}`,
  );
  if (git(directory, "rev-parse", `${result.head}^{commit}`) !== result.head)
    throw new Error("Result commit is unavailable.");
  if (result.updateBranch && result.updateCommit) {
    const existing = optionalGit(
      directory,
      "rev-parse",
      "--verify",
      `refs/heads/${result.updateBranch}`,
    );
    if (existing && existing !== result.updateCommit)
      throw new Error(`Local update branch collision: ${result.updateBranch}`);
    if (!existing)
      git(directory, "branch", result.updateBranch, result.updateCommit);
  }
  // Check again immediately before changing refs/worktree. Git itself rejects unsafe overwrites.
  const final = inspectCheckout(directory);
  if (
    final.head !== expected.head ||
    final.branch !== expected.branch ||
    sourceFingerprint(directory) !== expected.fingerprint
  )
    throw new Error("Checkout changed before delivery; bundle retained.");
  if (expected.head)
    git(directory, "merge", "--ff-only", "--no-overwrite-ignore", result.head);
  else {
    // An unborn checkout contains the original scaffold. Git read-tree refuses to overwrite
    // it, so first record the exact baseline that the container captured.
    const index = git(directory, "rev-parse", "--git-path", "index");
    const baselineIndex = resolve(artifacts, "baseline.index");
    const priorIndex = process.env.GIT_INDEX_FILE;
    try {
      process.env.GIT_INDEX_FILE = baselineIndex;
      git(directory, "read-tree", result.base);
      if (git(directory, "diff", "--name-only").length)
        throw new Error(
          "Scaffold no longer matches the captured baseline; bundle retained.",
        );
    } finally {
      if (priorIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = priorIndex;
    }
    cpSync(baselineIndex, resolve(directory, index));
    rmSync(baselineIndex);
    git(
      directory,
      "update-ref",
      `refs/heads/${expected.branch}`,
      result.base,
      "",
    );
    git(directory, "merge", "--ff-only", "--no-overwrite-ignore", result.head);
  }
  return result;
}

export async function main(args: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      directory: { type: "string", default: "." },
      profile: { type: "string" },
      owner: { type: "string" },
      "package-name": { type: "string" },
      description: { type: "string" },
      preset: { type: "string" },
      "with-functions": { type: "string", multiple: true },
      "without-functions": { type: "string", multiple: true },
      "target-branch": { type: "string" },
      "author-name": { type: "string" },
      "author-email": { type: "string" },
      preview: { type: "boolean", default: false },
    },
  });
  const operation = positionals[0];
  if (
    !["init", "update"].includes(operation ?? "") ||
    positionals.length !== 1 ||
    !values.profile ||
    (operation === "init" && !values.owner)
  )
    throw new Error(
      "Usage: bun run scripts/repository.ts <init|update> --profile <kind> [--owner <id>] [--directory <root>] [--preview]",
    );
  const directory = realpathSync(resolve(values.directory));
  const original = inspectCheckout(directory);
  if (operation === "update" && !original.head)
    throw new Error("update requires an existing Git commit.");
  if (
    values["target-branch"] &&
    original.branch &&
    values["target-branch"] !== original.branch
  )
    throw new Error("Target must match the checked-out branch.");
  const branch = original.branch ?? values["target-branch"] ?? "main";
  // Read the user's identity for input, but never copy their config/hooks into the container.
  const userConfig = (key: string) => {
    try {
      return execFileSync("git", ["-C", directory, "config", key], {
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  };
  const authorName = values["author-name"] ?? userConfig("user.name");
  const authorEmail = values["author-email"] ?? userConfig("user.email");
  if (!authorName || !authorEmail)
    throw new Error(
      "Configure user.name/user.email or supply --author-name and --author-email.",
    );
  const module = resolve(import.meta.dir, "..");
  mkdirSync(join(module, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(module, ".scratch/tmp_rovo_local_"));
  const snapshot = join(root, "input"),
    output = join(root, "output");
  mkdirSync(snapshot);
  const fingerprint = sourceFingerprint(directory);
  const history = join(root, "input.bundle");
  try {
    if (original.head)
      git(directory, "bundle", "create", history, "--branches", "--tags");
    else
      cpSync(directory, snapshot, {
        recursive: true,
        filter: (path) =>
          path === directory ||
          ![".git", "node_modules", ".scratch"].includes(basename(path)),
      });
    // Preflight a fresh scaffold's staged paths without changing the source index.
    if (!original.head) {
      git(snapshot, "init", "--initial-branch", branch, ".");
      git(snapshot, "add", "--all");
      checkStagedFiles(snapshot);
      rmSync(join(snapshot, ".git"), { recursive: true });
    }
    const command = [
      "-m",
      module,
      "call",
      operation ?? "",
      "--directory",
      snapshot,
      "--profile",
      values.profile,
      "--git",
      "--target-branch",
      branch,
      "--author-name",
      authorName,
      "--author-email",
      authorEmail,
    ];
    if (original.head) command.push("--history", history);
    for (const key of [
      "owner",
      "package-name",
      "description",
      "preset",
    ] as const)
      if (
        values[key] !== undefined &&
        (operation === "init" || key === "preset")
      )
        command.push(`--${key}`, values[key] ?? "");
    if (operation === "init" && !values["package-name"])
      command.push(
        "--package-name",
        existsSync(join(directory, "package.json"))
          ? (scaffoldName(
              readFileSync(join(directory, "package.json"), "utf8"),
            ) ?? basename(directory))
          : basename(directory),
      );
    for (const key of ["with-functions", "without-functions"] as const)
      for (const value of values[key] ?? []) command.push(`--${key}`, value);
    command.push("export", "--path", output);
    execFileSync("dagger", command, { cwd: module, stdio: "inherit" });
    if (values.preview) {
      console.log(`Preview artifacts: ${output}`);
      return;
    }
    const result = deliverRepository(directory, output, {
      branch,
      head: original.head,
      fingerprint,
    });
    console.log(
      `${result.status}: ${result.head}${result.updateBranch ? ` (${result.updateBranch})` : ""}`,
    );
    rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error(`Recovery files retained at ${root}`);
    throw error;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
