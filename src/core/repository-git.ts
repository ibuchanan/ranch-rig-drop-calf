import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { enforce, type Guard, withEnv } from "./guards.ts";

export type RepositoryOptions = {
  operation: "init" | "update";
  branch: string;
  authorName: string;
  authorEmail: string;
  remoteUrl?: string;
  provenance?: string;
};

export type RepositoryResult = {
  status: "initialized" | "updated" | "unchanged" | "failed";
  targetBranch: string;
  base: string;
  head: string;
  updateBranch?: string;
  updateCommit?: string;
  error?: string;
  published?: boolean;
};

export const INITIAL_COMMIT = "chore(scaffold): NONE Capture initial project";
export const INIT_COMMIT = "chore(drop-calf): NONE Initialize project tooling";
const UPDATE_COMMIT = "chore(drop-calf): NONE Update project tooling";
const MERGE_COMMIT = "chore(drop-calf): NONE Merge tooling update";

/** Git runs with isolated configuration, without repository hooks or interactive prompts. */
export function git(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "tag.gpgSign=false",
      "-C",
      directory,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

export function optionalGit(
  directory: string,
  ...args: string[]
): string | undefined {
  try {
    return git(directory, ...args);
  } catch {
    return undefined;
  }
}

/** Remote URL forms, tried in order; the first that applies decides acceptability. */
const REMOTE_FORMS: readonly {
  applies: (url: string) => boolean;
  acceptable: (url: string) => boolean;
  message: string;
}[] = [
  {
    applies: (url) => url.startsWith("https://") || url.startsWith("ssh://"),
    acceptable: (url) => {
      const { password, protocol, username, search, hash } = new URL(url);
      return !(
        password ||
        (protocol === "https:" && username) ||
        search ||
        hash
      );
    },
    message:
      "Remote URL must not contain credentials, query parameters, or fragments.",
  },
  {
    applies: () => true,
    acceptable: (url) => /^git@[^:/]+:.+/.test(url),
    message: "Remote URL must use credential-free HTTPS or SSH.",
  },
];

/** Why a remote URL is unacceptable, or undefined when it is fine. */
function remoteProblem(url: string): string | undefined {
  const form = REMOTE_FORMS.find(({ applies }) => applies(url));
  return form && !form.acceptable(url) ? form.message : undefined;
}

const OPTION_GUARDS: readonly Guard<RepositoryOptions>[] = [
  {
    fails: ({ authorName, authorEmail }) =>
      !authorName.trim() ||
      !authorEmail.trim() ||
      /[\r\n\0]/.test(authorName + authorEmail),
    message: "Git author name and email must be nonblank single-line values.",
  },
  {
    fails: ({ remoteUrl }) => Boolean(remoteUrl && remoteProblem(remoteUrl)),
    message: ({ remoteUrl }) => remoteProblem(remoteUrl ?? "") ?? "",
  },
];

/** Refuse common credential files even if an incomplete scaffold ignore file misses them. */
export function checkStagedFiles(directory: string): void {
  const paths = git(
    directory,
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ).split("\0");
  const suspicious = paths.filter(
    (path) =>
      /(^|\/)(\.env(?:\..+)?|\.npmrc|\.netrc|credentials(?:\.json)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/.test(
        path,
      ) && !/(^|\/)\.env\.(?:example|sample|template)$/.test(path),
  );
  // A generated .npmrc is ordinary configuration; authentication directives are not.
  const unsafe = suspicious.filter(
    (path) =>
      !path.endsWith(".npmrc") ||
      /(?:_auth|password|token)\s*=/i.test(git(directory, "show", `:${path}`)),
  );
  if (unsafe.length)
    throw new Error(
      `Refusing to commit potential credentials: ${unsafe.join(", ")}. Ignore or remove them first.`,
    );
}

type Checkout = {
  directory: string;
  options: RepositoryOptions;
  history?: string;
};

/** Where a checkout's content comes from, with the preconditions and cleanliness that implies. */
type Source = {
  guards: readonly Guard<Checkout>[];
  acquire: (checkout: Checkout) => void;
  /** A fetched repository must arrive clean; a scaffold is expected to be dirty. */
  mustBeClean: boolean;
};

const FROM_HISTORY: Source = {
  guards: [
    {
      fails: ({ directory }) => readdirSync(directory).length > 0,
      message: "Repository checkout destination must be empty.",
    },
  ],
  acquire({ directory, options, history }) {
    git(
      directory,
      "clone",
      "--no-local",
      "--",
      history ?? options.remoteUrl ?? "",
      ".",
    );
    git(directory, "switch", options.branch);
  },
  mustBeClean: true,
};

const FROM_SCAFFOLD: Source = {
  guards: [
    {
      fails: ({ directory }) => existsSync(join(directory, ".git")),
      message: "Supply repository history as a bundle; do not copy .git.",
    },
    {
      fails: ({ options }) => options.operation === "update",
      message: "update requires repository history or a remote URL.",
    },
  ],
  acquire({ directory, options }) {
    git(directory, "init", "--initial-branch", options.branch, ".");
  },
  mustBeClean: false,
};

const BEFORE_ACQUIRE: readonly Guard<Checkout>[] = [
  {
    fails: ({ options }) => options.branch.startsWith("drop-calf/update/"),
    message: "Select a target branch, not a Drop Calf update branch.",
  },
];

const INIT_MARKERS = ["catalog-info.yaml", ".atlassian/OWNER"];

const AFTER_ACQUIRE: readonly Guard<Checkout>[] = [
  {
    fails: ({ directory, options }) =>
      options.operation === "init" &&
      INIT_MARKERS.some((path) => existsSync(join(directory, path))),
    message: "init is a one-time operation; use update instead.",
  },
];

const NOT_CLEAN: Guard<Checkout> = {
  fails: ({ directory }) => git(directory, "status", "--porcelain") !== "",
  message: "Repository must be clean.",
};

const AFTER_INITIAL_COMMIT: readonly Guard<Checkout>[] = [
  {
    fails: ({ directory }) =>
      git(directory, "rev-parse", "--is-shallow-repository") !== "false",
    message: "Full Git history is required.",
  },
  {
    fails: ({ directory }) =>
      git(directory, "ls-files", "--stage")
        .split("\n")
        .some((line) => line.startsWith("160000 ")),
    message: "Submodules are not supported by repository workflows.",
  },
];

/** Prepare an isolated checkout from a bundle, a remote, or a fresh scaffold. */
export function prepareRepository(
  directory: string,
  options: RepositoryOptions,
  history?: string,
): void {
  enforce(options, OPTION_GUARDS);
  mkdirSync(directory, { recursive: true });
  git(directory, "check-ref-format", "--branch", options.branch);
  const checkout: Checkout = { directory, options, history };
  const source = history || options.remoteUrl ? FROM_HISTORY : FROM_SCAFFOLD;
  enforce(checkout, [...BEFORE_ACQUIRE, ...source.guards]);
  source.acquire(checkout);
  enforce(checkout, AFTER_ACQUIRE);
  for (const [key, value] of Object.entries({
    "user.name": options.authorName,
    "user.email": options.authorEmail,
    "core.autocrlf": "false",
  }))
    git(directory, "config", key, value);
  enforce(checkout, source.mustBeClean ? [NOT_CLEAN] : []);
  if (!optionalGit(directory, "rev-parse", "--verify", "HEAD")) {
    git(directory, "add", "--all");
    checkStagedFiles(directory);
    git(directory, "commit", "--allow-empty", "-m", INITIAL_COMMIT);
  }
  enforce(checkout, AFTER_INITIAL_COMMIT);
}

function commit(
  directory: string,
  message: string,
  options: RepositoryOptions,
  timestamp: number,
): void {
  const date = `${timestamp} +0000`;
  withEnv({ GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }, () =>
    git(
      directory,
      "commit",
      "-m",
      message,
      ...(options.provenance ? ["-m", options.provenance] : []),
    ),
  );
}

function exportRepository(
  directory: string,
  output: string,
  result: RepositoryResult,
): void {
  mkdirSync(output, { recursive: true });
  const bundle = resolve(output, "repository.bundle");
  rmSync(bundle, { force: true });
  git(directory, "bundle", "create", bundle, "--branches", "--tags");
  writeFileSync(
    join(output, "result.json"),
    `${JSON.stringify(result, null, 2)}\n`,
  );
}

/** Replace only the isolated worktree with the transformed tree. */
function replaceWorktree(directory: string, tree: string): void {
  const incoming = readdirSync(tree);
  if (incoming.includes(".git"))
    throw new Error("Transformation must not contain .git.");
  for (const name of readdirSync(directory).filter((n) => n !== ".git"))
    rmSync(join(directory, name), { recursive: true, force: true });
  for (const name of incoming)
    cpSync(join(tree, name), join(directory, name), {
      recursive: true,
      dereference: false,
    });
}

/** What the transformation turned out to be, handed to the operation that records it. */
type Change = {
  directory: string;
  options: RepositoryOptions;
  base: string;
  resultTree: string;
  timestamp: number;
};

type Outcome = Pick<RepositoryResult, "status" | "head"> &
  Partial<Pick<RepositoryResult, "updateBranch" | "updateCommit">>;

/** Unchanged `init` still counts as initialized; unchanged `update` is a no-op. */
const UNCHANGED_STATUS = {
  init: "initialized",
  update: "unchanged",
} as const;

/** The branch a tooling update lives on, named by the commit and tree it joins. */
const updateBranchName = ({ base, resultTree }: Change) =>
  `drop-calf/update/${base.slice(0, 12)}-${resultTree.slice(0, 12)}`;

/** An already-published update branch for this exact change, local first, then origin. */
function existingUpdate(directory: string, branch: string) {
  return [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].reduce<
    string | undefined
  >(
    (found, ref) =>
      found ?? optionalGit(directory, "rev-parse", "--verify", ref),
    undefined,
  );
}

/** Reuse of an existing update branch is safe only if it holds exactly this change. */
const holdsThisChange = (
  { directory, base, resultTree }: Change,
  existing: string,
) =>
  [
    () => git(directory, "show", "-s", "--format=%P", existing) === base,
    () => git(directory, "rev-parse", `${existing}^{tree}`) === resultTree,
    () =>
      git(directory, "show", "-s", "--format=%s", existing) === UPDATE_COMMIT,
  ].every((holds) => holds());

/** What each operation does with a transformation that changed the tree. */
const RECORD_CHANGE: Record<
  RepositoryOptions["operation"],
  (change: Change) => Outcome
> = {
  init(change) {
    const { directory, options, timestamp } = change;
    commit(directory, INIT_COMMIT, options, timestamp);
    return { status: "initialized", head: git(directory, "rev-parse", "HEAD") };
  },
  update(change) {
    const { directory, options, timestamp } = change;
    const branch = updateBranchName(change);
    const existing = existingUpdate(directory, branch);
    if (existing === undefined) {
      git(directory, "switch", "--create", branch);
      commit(directory, UPDATE_COMMIT, options, timestamp);
    } else {
      if (!holdsThisChange(change, existing))
        throw new Error(
          `Update branch collision: ${branch}; refusing to overwrite it.`,
        );
      git(directory, "switch", "-C", branch, existing);
    }
    const updateCommit = git(directory, "rev-parse", "HEAD");
    git(directory, "switch", options.branch);
    // --no-commit lets the normal commit path supply a stable timestamp.
    git(directory, "merge", "--no-ff", "--no-commit", branch);
    commit(directory, MERGE_COMMIT, options, timestamp + 1);
    return {
      status: "updated",
      head: git(directory, "rev-parse", "HEAD"),
      updateBranch: branch,
      updateCommit,
    };
  },
};

/** Replace only the isolated worktree, commit the transformation, and retain a real merge. */
export function finishRepository(
  directory: string,
  tree: string,
  options: RepositoryOptions,
  output: string,
): RepositoryResult {
  const base = git(directory, "rev-parse", "HEAD");
  const timestamp =
    Number(git(directory, "show", "-s", "--format=%ct", base)) + 1;
  replaceWorktree(directory, tree);
  git(directory, "add", "--all");
  checkStagedFiles(directory);
  const resultTree = git(directory, "write-tree");
  const unchanged: RepositoryResult = {
    status: UNCHANGED_STATUS[options.operation],
    targetBranch: options.branch,
    base,
    head: base,
  };
  const changed = resultTree !== git(directory, "rev-parse", `${base}^{tree}`);
  const result = changed
    ? {
        ...unchanged,
        ...RECORD_CHANGE[options.operation]({
          directory,
          options,
          base,
          resultTree,
          timestamp,
        }),
      }
    : unchanged;
  exportRepository(directory, output, result);
  return result;
}

/** Publish without force-pushing; leave the recovery branch if the target moved. */
export function publishRepository(
  directory: string,
  options: RepositoryOptions,
  result: RepositoryResult,
): RepositoryResult {
  if (!options.remoteUrl) throw new Error("Publication requires a remote URL.");
  if (result.status === "unchanged") return result;
  if (result.status !== "updated" || !result.updateBranch)
    throw new Error("Only successful updates can be published.");
  const target = `refs/heads/${options.branch}`;
  const updateRef = `refs/heads/${result.updateBranch}`;
  const existing = git(
    directory,
    "ls-remote",
    options.remoteUrl,
    updateRef,
  ).split(/\s/)[0];
  if (existing && existing !== result.updateCommit)
    throw new Error(
      `Remote update branch collision: ${result.updateBranch}; refusing to overwrite it.`,
    );
  git(
    directory,
    "push",
    options.remoteUrl,
    `refs/heads/${result.updateBranch}:refs/heads/${result.updateBranch}`,
  );
  const current = git(directory, "ls-remote", options.remoteUrl, target).split(
    /\s/,
  )[0];
  if (current !== result.base)
    throw new Error(
      `Remote ${options.branch} changed; update branch retained. Rerun against the new HEAD.`,
    );
  git(directory, "push", options.remoteUrl, `HEAD:${target}`);
  return { ...result, published: true };
}

if (import.meta.main) {
  const [stage, config, directory, output, extra] = process.argv.slice(2);
  if (!stage || !config || !directory || !output)
    throw new Error(
      "Expected stage, config, repository, output, and optional tree/history.",
    );
  const options: RepositoryOptions = await Bun.file(config).json();
  // Credentials affect transport only and are never persisted in repository configuration.
  if (process.env.DROP_CALF_AUTH_HEADER) {
    process.env.GIT_CONFIG_COUNT = "1";
    process.env.GIT_CONFIG_KEY_0 = "http.extraHeader";
    process.env.GIT_CONFIG_VALUE_0 = process.env.DROP_CALF_AUTH_HEADER;
  }
  if (stage === "prepare") prepareRepository(directory, options, extra);
  else if (stage === "finish" && extra)
    finishRepository(directory, extra, options, output);
  else if (stage === "publish") {
    const result: RepositoryResult = await Bun.file(
      join(output, "result.json"),
    ).json();
    exportRepository(
      directory,
      output,
      publishRepository(directory, options, result),
    );
  } else if (stage === "publication-failed") {
    const result: RepositoryResult = await Bun.file(
      join(output, "result.json"),
    ).json();
    writeFileSync(
      join(output, "result.json"),
      `${JSON.stringify({ ...result, status: "failed", error: "Publication failed; update branch and merge retained in bundle. Check remote refs before retrying." }, null, 2)}\n`,
    );
  } else if (stage === "recover") {
    const base = git(directory, "rev-parse", `refs/heads/${options.branch}`);
    exportRepository(directory, output, {
      status: "failed",
      targetBranch: options.branch,
      base,
      head: base,
      error: extra ?? "Repository workflow failed",
    });
  } else throw new Error(`Unknown stage: ${stage}`);
}
