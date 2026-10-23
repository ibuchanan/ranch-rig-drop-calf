import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { git, optionalGit } from "../../src/core/git.ts";
import { enforce, type Guard, withEnv } from "../../src/core/guards.ts";
import type { RepositoryResult } from "../../src/core/repository-types.ts";
import { inspectCheckout, sourceFingerprint } from "./checkout.ts";

export type Expected = { branch: string; head?: string; fingerprint: string };
type Delivery = {
  directory: string;
  artifacts: string;
  expected: Expected;
  result: RepositoryResult;
};

/**
 * Has the checkout moved since generation captured it? An uninitialized
 * directory has no branch yet, so `assumedBranch` stands in for it.
 */
function drifted(
  { directory, expected }: Delivery,
  assumedBranch?: string,
): boolean {
  const now = inspectCheckout(directory);
  return (
    now.head !== expected.head ||
    (now.branch ?? assumedBranch) !== expected.branch ||
    sourceFingerprint(directory) !== expected.fingerprint
  );
}

const BEFORE_IMPORT: readonly Guard<Delivery>[] = [
  {
    fails: ({ result }) => result.status === "failed",
    message: ({ result, artifacts }) =>
      `${result.error}; recovery artifacts retained at ${artifacts}`,
  },
  {
    fails: (delivery) => drifted(delivery, delivery.expected.branch),
    message: ({ artifacts }) =>
      `Checkout changed during generation; recovery artifacts retained at ${artifacts}`,
  },
  {
    fails: ({ result, expected }) =>
      result.targetBranch !== expected.branch ||
      (expected.head !== undefined && result.base !== expected.head),
    message: "Result does not match the captured repository base.",
  },
];

const AFTER_IMPORT: readonly Guard<Delivery>[] = [
  {
    fails: ({ directory, result }) =>
      git(directory, "rev-parse", `${result.head}^{commit}`) !== result.head,
    message: "Result commit is unavailable.",
  },
];

// Checked again immediately before changing refs/worktree. Git itself rejects unsafe overwrites.
const BEFORE_ADVANCE: readonly Guard<Delivery>[] = [
  {
    fails: (delivery) => drifted(delivery),
    message: "Checkout changed before delivery; bundle retained.",
  },
];

/** Bring the generated objects in. Only objects: the existing remote configuration is untouched. */
function importObjects({ directory, artifacts, expected }: Delivery): void {
  if (!existsSync(join(directory, ".git")))
    git(directory, "init", "--initial-branch", expected.branch, ".");
  const bundle = resolve(artifacts, "repository.bundle");
  git(directory, "bundle", "verify", bundle);
  git(
    directory,
    "fetch",
    "--no-write-fetch-head",
    bundle,
    `refs/heads/${expected.branch}`,
  );
}

/** Keep an existing update branch only when it already points at the update commit. */
function claimUpdateBranch({ directory, result }: Delivery): void {
  const { updateBranch, updateCommit } = result;
  if (!updateBranch || !updateCommit) return;
  const existing = optionalGit(
    directory,
    "rev-parse",
    "--verify",
    `refs/heads/${updateBranch}`,
  );
  if (existing === undefined)
    git(directory, "branch", updateBranch, updateCommit);
  else if (existing !== updateCommit)
    throw new Error(`Local update branch collision: ${updateBranch}`);
}

function fastForward({ directory, result }: Delivery): void {
  git(directory, "merge", "--ff-only", "--no-overwrite-ignore", result.head);
}

/**
 * An unborn checkout contains the original scaffold, and `git read-tree`
 * refuses to overwrite it. Record the exact baseline the container captured
 * first, then fast-forward onto the generated history.
 */
function adoptScaffoldBaseline(delivery: Delivery): void {
  const { directory, artifacts, expected, result } = delivery;
  const index = git(directory, "rev-parse", "--git-path", "index");
  const baselineIndex = resolve(artifacts, "baseline.index");
  withEnv({ GIT_INDEX_FILE: baselineIndex }, () => {
    git(directory, "read-tree", result.base);
    if (git(directory, "diff", "--name-only").length > 0)
      throw new Error(
        "Scaffold no longer matches the captured baseline; bundle retained.",
      );
  });
  cpSync(baselineIndex, resolve(directory, index));
  rmSync(baselineIndex);
  git(
    directory,
    "update-ref",
    `refs/heads/${expected.branch}`,
    result.base,
    "",
  );
  fastForward(delivery);
}

/** How the checkout moves onto the generated commit, by whether it already has history. */
const ADVANCE = {
  committed: fastForward,
  unborn: adoptScaffoldBaseline,
} as const;

/** Import objects first, then advance the checkout only if its original state still matches. */
export function deliverRepository(
  directory: string,
  artifacts: string,
  expected: Expected,
): RepositoryResult {
  const result: RepositoryResult = JSON.parse(
    readFileSync(join(artifacts, "result.json"), "utf8"),
  );
  const delivery: Delivery = { directory, artifacts, expected, result };
  enforce(delivery, BEFORE_IMPORT);
  if (result.status === "unchanged") return result;
  importObjects(delivery);
  enforce(delivery, AFTER_IMPORT);
  claimUpdateBranch(delivery);
  enforce(delivery, BEFORE_ADVANCE);
  ADVANCE[expected.head ? "committed" : "unborn"](delivery);
  return result;
}
