import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { git, optionalGit } from "../../src/core/git.ts";

/** Entries that never belong to the source snapshot or its fingerprint. */
export const SKIPPED_ENTRIES = [".git", "node_modules", ".scratch"];

/** Snapshot all source, including ignored files, without reading .git or dependency trees. */
export function sourceFingerprint(directory: string): string {
  const hash = createHash("sha256");
  function visit(relative: string): void {
    for (const entry of readdirSync(join(directory, relative)).sort()) {
      if (SKIPPED_ENTRIES.includes(entry)) continue;
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
