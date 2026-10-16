import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

function run(command: string, ...args: string[]): string {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout.trimEnd();
}

try {
  const { values } = parseArgs({
    options: { remote: { type: "string" }, branch: { type: "string" } },
  });
  const { remote, branch } = values;
  if (!remote || !branch)
    throw new Error("Specify --remote <name> --branch <branch> explicitly.");
  if (
    resolve(run("git", "rev-parse", "--show-toplevel")) !==
    resolve(process.cwd())
  )
    throw new Error("Run release:publish from the repository root.");
  run("git", "check-ref-format", `refs/heads/${branch}`);
  let currentBranch: string;
  try {
    currentBranch = run("git", "symbolic-ref", "--short", "HEAD");
  } catch {
    throw new Error(
      "A checked-out branch is required; detached HEAD cannot be published.",
    );
  }
  if (currentBranch !== branch)
    throw new Error(
      `Expected branch ${branch}, found ${currentBranch}; check out the intended branch and prepare there.`,
    );
  if (run("git", "rev-parse", "--is-shallow-repository") !== "false")
    throw new Error("A complete Git history is required before publication.");
  for (const state of [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
    "BISECT_LOG",
  ]) {
    if (existsSync(run("git", "rev-parse", "--git-path", state)))
      throw new Error(
        `Git operation in progress (${state}); finish or abort it first.`,
      );
  }
  if (!run("git", "remote").split("\n").includes(remote))
    throw new Error(
      `Unknown remote ${remote}; configure the intended remote explicitly.`,
    );
  const destinations = run(
    "git",
    "remote",
    "get-url",
    "--push",
    "--all",
    remote,
  ).split("\n");
  if (destinations.length !== 1 || !destinations[0])
    throw new Error(
      "Exactly one push destination is required for the selected remote.",
    );
  const destination = destinations[0];
  const receiptPath = run(
    "git",
    "rev-parse",
    "--git-path",
    "drop-calf-release.json",
  );
  if (!existsSync(receiptPath))
    throw new Error(
      "No preparation receipt; run release:prepare from a clean baseline and review its outputs first.",
    );
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  if (receipt.branch !== branch)
    throw new Error(
      `Release was prepared on branch ${receipt.branch}, not ${branch}.`,
    );
  if (!["package-lock.json", "bun.lock"].includes(receipt.lockfile))
    throw new Error(
      "Invalid preparation receipt; restore the clean baseline and rerun release:prepare.",
    );
  if (run("git", "rev-parse", "HEAD") !== receipt.head)
    throw new Error(
      "HEAD differs from preparation; restore the baseline and prepare again.",
    );
  const outputs = ["package.json", receipt.lockfile, "CHANGELOG.md"];
  function verifyPrepared() {
    for (const path of [...outputs, "cliff.toml"]) {
      if (
        !lstatSync(path).isFile() ||
        createHash("sha256").update(readFileSync(path)).digest("hex") !==
          receipt.files[path]
      )
        throw new Error(
          `${path} differs from preparation; restore the prepared output or prepare again from the clean baseline.`,
        );
    }
  }
  verifyPrepared();
  function verifyChanges() {
    const changes = run(
      "git",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
    )
      .split("\0")
      .filter(Boolean);
    for (const change of changes) {
      if (!/^[ M]{2} /.test(change) || !outputs.includes(change.slice(3)))
        throw new Error(
          `Unrelated or unsupported change ${JSON.stringify(change)}; preserve it separately before publication.`,
        );
    }
    for (const path of run("git", "diff", "--cached", "--name-only", "-z")
      .split("\0")
      .filter(Boolean)) {
      if (
        run("git", "rev-parse", `:${path}`) !==
        run("git", "hash-object", `--path=${path}`, "--", path)
      )
        throw new Error(
          `Staged ${path} differs from the prepared working file; preserve the staged edit separately before publication.`,
        );
    }
  }
  verifyChanges();
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const tag = receipt.tag;
  if (pkg.version !== receipt.version || tag.replace(/^v/, "") !== pkg.version)
    throw new Error("Package version and preparation tag disagree.");
  run("git", "check-ref-format", `refs/tags/${tag}`);
  if (
    run("git", "tag", "--list")
      .split("\n")
      .some((existing) => existing.replace(/^v/, "") === pkg.version)
  )
    throw new Error(
      `Release tag for ${pkg.version} already exists locally; inspect it rather than overwriting it.`,
    );
  function verifyRemote() {
    const remoteRefs = run(
      "git",
      "ls-remote",
      "--refs",
      "--",
      destination,
      `refs/heads/${branch}`,
      "refs/tags/*",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"));
    if (
      remoteRefs.some(
        ([, ref]) =>
          ref?.startsWith("refs/tags/") &&
          ref.slice(10).replace(/^v/, "") === pkg.version,
      )
    )
      throw new Error(
        `Release tag for ${pkg.version} already exists remotely; inspect it rather than overwriting it.`,
      );
    if (
      remoteRefs.find(([, ref]) => ref === `refs/heads/${branch}`)?.[0] !==
      receipt.head
    )
      throw new Error(
        "Remote branch must exist and exactly match the preparation baseline; synchronize and prepare again.",
      );
  }
  verifyRemote();
  for (const check of ["test", "typecheck", "pack:check"]) {
    if (!pkg.scripts?.[check])
      throw new Error(`Required release check ${check} is missing.`);
    console.log(run("bun", "run", check));
  }
  verifyPrepared();
  verifyChanges();
  if (
    run("git", "rev-parse", "HEAD") !== receipt.head ||
    run("git", "symbolic-ref", "--short", "HEAD") !== branch
  )
    throw new Error(
      "HEAD differs after release checks; inspect check side effects before recovery.",
    );
  verifyRemote();
  try {
    run("git", "add", "--", ...outputs);
    const expectedTree = run("git", "write-tree");
    run("git", "commit", "-m", `chore(release): prepare for ${tag}`);
    const commit = run("git", "rev-parse", "HEAD");
    if (
      run("git", "rev-parse", "HEAD^{tree}") !== expectedTree ||
      run("git", "rev-list", "--parents", "-n", "1", "HEAD") !==
        `${commit} ${receipt.head}` ||
      run("git", "symbolic-ref", "--short", "HEAD") !== branch
    )
      throw new Error(
        "Release commit differs from the checked tree or baseline; inspect commit-hook side effects before recovery.",
      );
    verifyPrepared();
    verifyChanges();
    run("git", "tag", "--no-sign", tag, commit);
    run(
      "git",
      "-c",
      "push.followTags=false",
      "push",
      "--atomic",
      "--",
      destination,
      `${commit}:refs/heads/${branch}`,
      `refs/tags/${tag}:refs/tags/${tag}`,
    );
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\nNo automatic rollback. Inspect git status, HEAD, ${tag}, and the remote refs. Local staging, commit, or tag may remain; a transport failure can leave remote outcome unknown. Do not rerun preparation or overwrite refs. Follow the documented publication recovery procedure.`,
    );
  }
  console.log(
    `Published ${tag} to ${remote} ${branch}; no registry publication occurred.`,
  );
} catch (error) {
  console.error(
    `release:publish: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
