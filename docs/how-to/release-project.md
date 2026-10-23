# Release a project

<!-- cspell:words versionless -->

Use this procedure for `library`, `forge-app`, `tool`, and `agent-skill`
repositories with the shared `release` script. One invocation runs checks,
updates version metadata and release notes, commits, tags, and pushes.
There is no manual checkpoint between these operations.

## Prerequisites

- Install development dependencies with the repository's declared package
  manager. Bash, Git, Bun, and the installed `git-cliff` must be available.
  npm kinds also require the npm CLI; Bun kinds require `jq`.
  `scripts/release.sh` performs the release directly, without a TypeScript
  helper.
- Work from the repository root on a checked-out `main` branch with complete
  history and release tags. Finish any merge, rebase, cherry-pick, revert, or
  bisect.
- Start with a clean index/worktree, including untracked files. Ignored build
  artifacts are allowed.
- Keep exactly one supported lockfile: npm `package-lock.json` format 2/3 with
  matching root metadata, or text `bun.lock`. Bun locks are preserved without
  parsing or rewriting; the script does not validate their internal format.
- Synchronize the `origin` remote's `main` branch to local HEAD and obtain
  permission to push the branch and create release tags.

## Run the release

1. Run the following from the repository root:

   ```sh
   bun run release
   ```

   The script performs all steps in a single invocation: checks, version and
   changelog updates, commit, tag, and atomic push to `origin main`.

2. Check Git's output for the release commit, tag, and pushed refs.
   Success means the release commit and `vMAJOR.MINOR.PATCH` tag were pushed
   atomically. Registry publication, Forge deployment, catalog updates, and
   public announcements are not part of this command.

## Configure automated checks

Edit `scripts["release:check"]` to add repository-specific checks. The defaults
are:

| Kind                  | Default checks                                            |
| --------------------- | --------------------------------------------------------- |
| `library`             | `npm run test && npm run typecheck && npm run pack:check` |
| `forge-app`           | `npm run test && npm run typecheck`                       |
| `tool`, `agent-skill` | `bun run test && bun run typecheck`                       |

A missing/failing check or an unexpected file change blocks release before
version or changelog writes. Existing check scripts are preserved on update.
Git hooks and configured commit/tag signing remain active. Review custom
checks as executable repository code; do not include publication or deployment
in the verification script.

Keep version/changelog policy in owner-managed `cliff.toml`. Breaking changes
on 0.x use the seeded minor-bump policy unless the owner changes it. A first
release may equal the seeded package version; subsequent releases must advance.
The script renders the complete changelog with its configured header. The npm
variant uses `npm version` without Git tagging or version lifecycle scripts;
the Bun variant uses `jq` to update the package version and leaves its lock
unchanged. Commands are selected during scaffolding, not detected at release
runtime.
Review existing hand-authored notes before adopting a full-history renderer.

## Recover from a failure

The script stops at the failing command and performs no destructive rollback.
It does not audit lockfile formats, compare remote state, or verify what hooks
change. Use trusted checks/hooks and inspect the Git state on failure.
- Before release-file writes, fix the reported issue, inspect any check side
  effects, and restore the required clean starting state before retrying.
- After file writes or a commit-hook failure, inspect `git status`, HEAD, and
  the index. Preserve owner work. Do not rerun blindly or reset indiscriminately.
- After commit/tag creation, inspect the reported local artifacts and remote
  refs at the **push destination**. If both remote refs identify the intended
  release, it already succeeded. If neither does, a maintainer can retry only
  the same verified refs; mismatched refs require investigation.
- Atomic push rejection leaves the remote branch and tag unchanged, but a
  transport error may happen after acceptance. Never force-push or move a
  release tag to recover.

For a reviewed push-only retry, substitute the recorded commit, tag, branch,
and resolved push URL (not an unchecked fetch URL):

```sh
git -c push.followTags=false push --atomic -- <push-url> \
  <release-commit>:refs/heads/<branch> refs/tags/<tag>:refs/tags/<tag>
```

Run only one release at a time. The interim Bash script has no concurrency
lock, receipt store, or automatic resume. It stops on errors and leaves local
artifacts visible for inspection.

## Adopt the shared command

Review the Drop Calf update diff for changes to `scripts.release` and
`release:check`. The release script is owned by the capability; do not customize
it in place. Update replaces it.

If using the old `release:prepare` / `release:publish` workflow, resolve any
in-progress release before adopting the unified command. Existing commands and
helpers are not automatically deleted; review and remove them after validating
the new workflow. New repositories receive only `release` and its automated
`release:check`.
