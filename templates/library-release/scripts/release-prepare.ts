import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

function run(command: string, ...args: string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  return result.stdout.trim();
}

try {
  if (
    resolve(run("git", "rev-parse", "--show-toplevel")) !==
    resolve(process.cwd())
  )
    throw new Error("Run release:prepare from the repository root.");
  try {
    run("git", "rev-parse", "--verify", "HEAD");
  } catch {
    throw new Error("Git commit history is required before preparation.");
  }
  try {
    run("git", "symbolic-ref", "--quiet", "HEAD");
  } catch {
    throw new Error(
      "A checked-out branch is required; detached HEAD is unsuitable for release review.",
    );
  }
  if (run("git", "rev-parse", "--is-shallow-repository") !== "false")
    throw new Error(
      "A complete Git history and release tags are required; obtain the full history before preparation.",
    );
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
        `Git operation in progress (${state}); finish or abort it before preparation.`,
      );
  }
  if (!existsSync("cliff.toml"))
    throw new Error(
      "cliff.toml is required; restore the owner-managed release policy before preparation.",
    );
  if (run("git", "status", "--porcelain", "--untracked-files=all"))
    throw new Error(
      "A clean working tree is required; review, commit, or restore existing changes before preparation.",
    );
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  if (pkg.workspaces)
    throw new Error(
      "Workspace releases are unsupported; prepare releases with the repository's workspace tooling.",
    );
  const lockfiles = [
    "package-lock.json",
    "bun.lock",
    "bun.lockb",
    "npm-shrinkwrap.json",
    "yarn.lock",
    "pnpm-lock.yaml",
  ].filter(existsSync);
  if (
    lockfiles.length !== 1 ||
    !["package-lock.json", "bun.lock"].includes(lockfiles[0]!)
  )
    throw new Error(
      `Expected exactly one supported lockfile (package-lock.json or bun.lock); found ${lockfiles.join(", ") || "none"}. Resolve the package-manager arrangement explicitly before preparation.`,
    );
  const lockfile = lockfiles[0]!;
  for (const path of ["package.json", lockfile, "CHANGELOG.md", "cliff.toml"]) {
    if (!lstatSync(path).isFile())
      throw new Error(
        `${path} must be a regular file, not a symlink or directory.`,
      );
    accessSync(path, constants.R_OK | constants.W_OK);
  }
  const manager = lockfile === "package-lock.json" ? "npm" : "bun";
  if (
    pkg.packageManager !== undefined &&
    (typeof pkg.packageManager !== "string" ||
      !pkg.packageManager.startsWith(`${manager}@`))
  )
    throw new Error(
      `packageManager must agree with ${lockfile}; expected ${manager}@<version>.`,
    );
  const lock =
    manager === "npm"
      ? JSON.parse(readFileSync(lockfile, "utf8"))
      : Bun.JSONC.parse(readFileSync(lockfile, "utf8"));
  if (manager === "npm") {
    if (
      ![2, 3].includes(lock?.lockfileVersion) ||
      lock?.version !== pkg.version ||
      lock?.packages?.[""]?.version !== pkg.version ||
      lock?.packages?.[""]?.name !== pkg.name
    )
      throw new Error(
        "Unsupported or inconsistent package-lock.json; use npm lockfileVersion 2 or 3 with matching root package metadata before preparation.",
      );
  } else if (
    ![1, 2].includes(lock?.lockfileVersion) ||
    lock?.workspaces?.[""]?.name !== pkg.name ||
    Object.keys(lock?.workspaces ?? {}).length !== 1 ||
    lock.workspaces[""].version !== undefined ||
    !lock.packages
  ) {
    throw new Error(
      "Unsupported bun.lock; use a single-package Bun text lock with a versionless root workspace before preparation.",
    );
  }
  const tag = run(
    "git",
    "cliff",
    "--offline",
    "--no-exec",
    "--config",
    "cliff.toml",
    "--bumped-version",
  );
  const version = tag.replace(/^v/, "");
  const semver =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;
  if (!semver.test(version) || !semver.test(pkg.version))
    throw new Error(
      `Invalid release version: git-cliff returned ${JSON.stringify(tag)}; package version is ${JSON.stringify(pkg.version)}.`,
    );
  if (Bun.semver.order(version, pkg.version) <= 0)
    throw new Error(
      `Release ${version} does not advance package version ${pkg.version}; this history may already be prepared.`,
    );
  if (
    run("git", "tag", "--list")
      .split("\n")
      .some((existing) => existing.replace(/^v/, "") === version)
  )
    throw new Error(
      `Release tag for ${version} already exists; use new unreleased history, not an existing release.`,
    );
  // Render away from release files so template/tool failure cannot truncate owner output.
  const temporary = mkdtempSync(
    join(run("git", "rev-parse", "--git-path", "."), "release-prepare-"),
  );
  let changelog: string;
  try {
    const output = join(temporary, "CHANGELOG.md");
    run(
      "git",
      "cliff",
      "--offline",
      "--no-exec",
      "--config",
      "cliff.toml",
      "--tag",
      tag,
      "--output",
      output,
    );
    changelog = readFileSync(output, "utf8");
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  pkg.version = version;
  // Version-only releases change npm's root metadata, not dependency resolutions.
  // Bun text locks omit the root version, so they remain byte-for-byte unchanged.
  if (manager === "npm") {
    lock.version = version;
    lock.packages[""].version = version;
  }
  writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  if (manager === "npm")
    writeFileSync(lockfile, `${JSON.stringify(lock, null, 2)}\n`);
  writeFileSync("CHANGELOG.md", changelog);
  console.log(
    `Prepared ${tag} locally; review the package, lockfile, and CHANGELOG.md diff. Nothing was staged or published.`,
  );
} catch (error) {
  console.error(
    `release:prepare: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
