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
export const UPDATE_COMMIT = "chore(drop-calf): NONE Update project tooling";
export const MERGE_COMMIT = "chore(drop-calf): NONE Merge tooling update";

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

function optionalGit(directory: string, ...args: string[]): string | undefined {
  try {
    return git(directory, ...args);
  } catch {
    return undefined;
  }
}

function checkOptions(options: RepositoryOptions): void {
  if (
    !options.authorName.trim() ||
    !options.authorEmail.trim() ||
    /[\r\n\0]/.test(options.authorName + options.authorEmail)
  )
    throw new Error(
      "Git author name and email must be nonblank single-line values.",
    );
  if (options.remoteUrl) {
    const url = options.remoteUrl;
    if (url.startsWith("https://") || url.startsWith("ssh://")) {
      const parsed = new URL(url);
      if (
        parsed.password ||
        (parsed.protocol === "https:" && parsed.username) ||
        parsed.search ||
        parsed.hash
      )
        throw new Error(
          "Remote URL must not contain credentials, query parameters, or fragments.",
        );
    } else if (!/^git@[^:/]+:.+/.test(url)) {
      throw new Error("Remote URL must use credential-free HTTPS or SSH.");
    }
  }
}

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

/** Prepare an isolated checkout from a bundle, a remote, or a fresh scaffold. */
export function prepareRepository(
  directory: string,
  options: RepositoryOptions,
  history?: string,
): void {
  checkOptions(options);
  mkdirSync(directory, { recursive: true });
  git(directory, "check-ref-format", "--branch", options.branch);
  if (options.branch.startsWith("drop-calf/update/"))
    throw new Error("Select a target branch, not a Drop Calf update branch.");
  if (history || options.remoteUrl) {
    if (readdirSync(directory).length)
      throw new Error("Repository checkout destination must be empty.");
    git(
      directory,
      "clone",
      "--no-local",
      "--",
      history ?? options.remoteUrl ?? "",
      ".",
    );
    git(directory, "switch", options.branch);
  } else {
    if (existsSync(join(directory, ".git")))
      throw new Error(
        "Supply repository history as a bundle; do not copy .git.",
      );
    if (options.operation === "update")
      throw new Error("update requires repository history or a remote URL.");
    git(directory, "init", "--initial-branch", options.branch, ".");
  }
  if (
    options.operation === "init" &&
    ["catalog-info.yaml", ".atlassian/OWNER"].some((path) =>
      existsSync(join(directory, path)),
    )
  )
    throw new Error("init is a one-time operation; use update instead.");
  git(directory, "config", "user.name", options.authorName);
  git(directory, "config", "user.email", options.authorEmail);
  git(directory, "config", "core.autocrlf", "false");
  if (git(directory, "status", "--porcelain") && (history || options.remoteUrl))
    throw new Error("Repository must be clean.");
  if (!optionalGit(directory, "rev-parse", "--verify", "HEAD")) {
    git(directory, "add", "--all");
    checkStagedFiles(directory);
    git(directory, "commit", "--allow-empty", "-m", INITIAL_COMMIT);
  }
  if (git(directory, "rev-parse", "--is-shallow-repository") !== "false")
    throw new Error("Full Git history is required.");
  if (
    git(directory, "ls-files", "--stage")
      .split("\n")
      .some((line) => line.startsWith("160000 "))
  )
    throw new Error("Submodules are not supported by repository workflows.");
}

function commit(
  directory: string,
  message: string,
  options: RepositoryOptions,
  timestamp: number,
): void {
  const oldAuthor = process.env.GIT_AUTHOR_DATE;
  const oldCommitter = process.env.GIT_COMMITTER_DATE;
  try {
    process.env.GIT_AUTHOR_DATE = `${timestamp} +0000`;
    process.env.GIT_COMMITTER_DATE = `${timestamp} +0000`;
    git(
      directory,
      "commit",
      "-m",
      message,
      ...(options.provenance ? ["-m", options.provenance] : []),
    );
  } finally {
    if (oldAuthor === undefined) delete process.env.GIT_AUTHOR_DATE;
    else process.env.GIT_AUTHOR_DATE = oldAuthor;
    if (oldCommitter === undefined) delete process.env.GIT_COMMITTER_DATE;
    else process.env.GIT_COMMITTER_DATE = oldCommitter;
  }
}

export function exportRepository(
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
  for (const name of readdirSync(directory))
    if (name !== ".git")
      rmSync(join(directory, name), { recursive: true, force: true });
  for (const name of readdirSync(tree)) {
    if (name === ".git")
      throw new Error("Transformation must not contain .git.");
    cpSync(join(tree, name), join(directory, name), {
      recursive: true,
      dereference: false,
    });
  }
  git(directory, "add", "--all");
  checkStagedFiles(directory);
  const resultTree = git(directory, "write-tree");
  let result: RepositoryResult = {
    status: options.operation === "init" ? "initialized" : "unchanged",
    targetBranch: options.branch,
    base,
    head: base,
  };
  if (resultTree !== git(directory, "rev-parse", `${base}^{tree}`)) {
    if (options.operation === "init") {
      commit(directory, INIT_COMMIT, options, timestamp);
      result = {
        ...result,
        status: "initialized",
        head: git(directory, "rev-parse", "HEAD"),
      };
    } else {
      const branch = `drop-calf/update/${base.slice(0, 12)}-${resultTree.slice(0, 12)}`;
      const existing =
        optionalGit(
          directory,
          "rev-parse",
          "--verify",
          `refs/heads/${branch}`,
        ) ??
        optionalGit(
          directory,
          "rev-parse",
          "--verify",
          `refs/remotes/origin/${branch}`,
        );
      if (existing) {
        if (
          git(directory, "show", "-s", "--format=%P", existing) !== base ||
          git(directory, "rev-parse", `${existing}^{tree}`) !== resultTree ||
          git(directory, "show", "-s", "--format=%s", existing) !==
            UPDATE_COMMIT
        )
          throw new Error(
            `Update branch collision: ${branch}; refusing to overwrite it.`,
          );
        git(directory, "switch", "-C", branch, existing);
      } else {
        git(directory, "switch", "--create", branch);
        commit(directory, UPDATE_COMMIT, options, timestamp);
      }
      const updateCommit = git(directory, "rev-parse", "HEAD");
      git(directory, "switch", options.branch);
      // --no-commit lets the normal commit path supply a stable timestamp.
      git(directory, "merge", "--no-ff", "--no-commit", branch);
      commit(directory, MERGE_COMMIT, options, timestamp + 1);
      result = {
        ...result,
        status: "updated",
        head: git(directory, "rev-parse", "HEAD"),
        updateBranch: branch,
        updateCommit,
      };
    }
  }
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
