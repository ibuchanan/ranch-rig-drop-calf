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
import { enforce, type Guard, withEnv } from "../src/core/guards.ts";
import {
  checkStagedFiles,
  git,
  optionalGit,
  type RepositoryResult,
} from "../src/core/repository-git.ts";

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

type Expected = { branch: string; head?: string; fingerprint: string };
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

const OPTIONS = {
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
} as const;

const parse = (args: string[]) =>
  parseArgs({ args, allowPositionals: true, options: OPTIONS });
type Values = ReturnType<typeof parse>["values"];

type Operation = {
  /** Options that must be present for the invocation to be well formed. */
  required: readonly ("profile" | "owner")[];
  /** Options passed through to the Dagger call. */
  forwarded: readonly ("owner" | "package-name" | "description" | "preset")[];
  requiresCommit: boolean;
  /** Derive a package name from the scaffold when none is given. */
  seedsPackageName: boolean;
};

export const OPERATIONS = new Map<string, Operation>([
  [
    "init",
    {
      required: ["profile", "owner"],
      forwarded: ["owner", "package-name", "description", "preset"],
      requiresCommit: false,
      seedsPackageName: true,
    },
  ],
  [
    "update",
    {
      required: ["profile"],
      forwarded: ["preset"],
      requiresCommit: true,
      seedsPackageName: false,
    },
  ],
]);

const USAGE =
  "Usage: bun run scripts/repository.ts <init|update> --profile <kind> [--owner <id>] [--directory <root>] [--preview]";

type Request = {
  operation: string;
  spec: Operation;
  values: Values;
  directory: string;
  original: ReturnType<typeof inspectCheckout>;
  branch: string;
  identity: { name: string; email: string };
};

const REQUEST_GUARDS: readonly Guard<Request>[] = [
  {
    fails: ({ spec, original }) => spec.requiresCommit && !original.head,
    message: "update requires an existing Git commit.",
  },
  {
    fails: ({ values, original }) =>
      Boolean(values["target-branch"] && original.branch) &&
      values["target-branch"] !== original.branch,
    message: "Target must match the checked-out branch.",
  },
  {
    fails: ({ identity }) => !identity.name || !identity.email,
    message:
      "Configure user.name/user.email or supply --author-name and --author-email.",
  },
];

/** Read the user's identity for input, but never copy their config/hooks into the container. */
function userConfig(directory: string, key: string): string {
  try {
    return execFileSync("git", ["-C", directory, "config", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function resolveRequest(args: string[]): Request {
  const { values, positionals } = parse(args);
  const [operation = ""] = positionals;
  const spec = OPERATIONS.get(operation);
  if (
    !spec ||
    positionals.length !== 1 ||
    !spec.required.every((key) => values[key])
  )
    throw new Error(USAGE);
  const directory = realpathSync(resolve(values.directory));
  const original = inspectCheckout(directory);
  const request: Request = {
    operation,
    spec,
    values,
    directory,
    original,
    branch: original.branch ?? values["target-branch"] ?? "main",
    identity: {
      name: values["author-name"] ?? userConfig(directory, "user.name"),
      email: values["author-email"] ?? userConfig(directory, "user.email"),
    },
  };
  enforce(request, REQUEST_GUARDS);
  return request;
}

type Workspace = {
  directory: string;
  snapshot: string;
  history: string;
  branch: string;
};

const SKIPPED_ENTRIES = [".git", "node_modules", ".scratch"];

/** Captures the source for the container and returns any Dagger flags it needs. */
type Baseline = (workspace: Workspace) => string[];

const BASELINES: Record<"committed" | "unborn", Baseline> = {
  committed({ directory, history }) {
    git(directory, "bundle", "create", history, "--branches", "--tags");
    return ["--history", history];
  },
  unborn({ directory, snapshot, branch }) {
    cpSync(directory, snapshot, {
      recursive: true,
      filter: (path) =>
        path === directory || !SKIPPED_ENTRIES.includes(basename(path)),
    });
    // Preflight a fresh scaffold's staged paths without changing the source index.
    git(snapshot, "init", "--initial-branch", branch, ".");
    git(snapshot, "add", "--all");
    checkStagedFiles(snapshot);
    rmSync(join(snapshot, ".git"), { recursive: true });
    return [];
  },
};

/** `--name value` pairs for an absent, single, or repeated option. */
const flags = (name: string, value: string | readonly string[] | undefined) =>
  [value ?? []].flat().flatMap((each) => [`--${name}`, each]);

function scaffoldPackageName(directory: string): string {
  const manifest = join(directory, "package.json");
  return (
    (existsSync(manifest)
      ? scaffoldName(readFileSync(manifest, "utf8"))
      : undefined) ?? basename(directory)
  );
}

export function daggerArguments(
  { operation, spec, values, directory, branch, identity }: Request,
  { snapshot }: Workspace,
  module: string,
  baselineFlags: string[],
  output: string,
): string[] {
  return [
    "-m",
    module,
    "call",
    operation,
    ...flags("directory", snapshot),
    ...flags("profile", values.profile),
    "--git",
    ...flags("target-branch", branch),
    ...flags("author-name", identity.name),
    ...flags("author-email", identity.email),
    ...baselineFlags,
    ...spec.forwarded.flatMap((key) => flags(key, values[key])),
    ...(spec.seedsPackageName && !values["package-name"]
      ? flags("package-name", scaffoldPackageName(directory))
      : []),
    ...flags("with-functions", values["with-functions"]),
    ...flags("without-functions", values["without-functions"]),
    "export",
    ...flags("path", output),
  ];
}

async function main(args: string[]): Promise<void> {
  const request = resolveRequest(args);
  const { values, directory, original, branch } = request;
  const module = resolve(import.meta.dir, "..");
  mkdirSync(join(module, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(module, ".scratch/tmp_rovo_local_"));
  const workspace: Workspace = {
    directory,
    snapshot: join(root, "input"),
    history: join(root, "input.bundle"),
    branch,
  };
  const output = join(root, "output");
  mkdirSync(workspace.snapshot);
  const fingerprint = sourceFingerprint(directory);
  try {
    const baselineFlags =
      BASELINES[original.head ? "committed" : "unborn"](workspace);
    execFileSync(
      "dagger",
      daggerArguments(request, workspace, module, baselineFlags, output),
      { cwd: module, stdio: "inherit" },
    );
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
