# Prepare a library release locally

Use this procedure in a single-package repository initialized or updated with the
`library` profile. Preparation changes local files only; Git publication and
registry publication are separate, deliberate operations.

## Prepare and review

1. Install the repository's development tools before starting. Use its declared
   package manager and existing lockfile; do not switch managers to run this
   workflow. Bun is required to execute the helper even for npm-managed packages.
   Git and the local `git-cliff` binary supplied by `changelog` must be available.
   Tool installation is separate and may use the network and installation scripts.

2. Obtain the complete commit history and release tags, check out a branch, and
   finish any merge, rebase, cherry-pick, revert, or bisect. Run from the repository
   root with a clean index and working tree, including untracked files. Commit
   owner changes to `cliff.toml` before preparation. Preserve prose in its header,
   not in generated `CHANGELOG.md`.

3. Check that the repository has exactly one supported lockfile:

   - For npm, use `package-lock.json` format 2 or 3 with root name and version
     matching `package.json`.
   - For Bun, use a text `bun.lock` format 1 or 2 with a single, versionless root
     workspace matching the package name.
   - If `packageManager` is present, it must agree with the lockfile. Otherwise
     the sole supported lockfile selects the manager. Resolve missing, multiple,
     contradictory, binary Bun, shrinkwrap, Yarn, or pnpm locks yourself. Workspace
     release orchestration is not supported. The helper never deletes, converts,
     or invents a lockfile.

4. Run the explicit command:

   ```sh
   bun run release:prepare
   ```

   The helper asks git-cliff for the next version using the repository's
   conventional commits, tags, and `cliff.toml`. The seeded policy keeps breaking
   0.x changes minor; owner policy remains authoritative. If no tags exist,
   git-cliff's initial version must still exceed the package's current version.
   An invalid, already-tagged, or non-advancing result stops preparation.

   Preparation uses git-cliff offline with external command execution disabled.
   Policy preprocessors that execute commands are therefore unsupported here.
   It renders the entire changelog with the calculated release tag, not a prepended
   unreleased fragment. Rendering finishes in temporary Git storage before release
   files are written; that temporary directory is removed afterwards.

5. Review the local changes:

   ```sh
   git status --short
   git diff -- package.json package-lock.json bun.lock CHANGELOG.md
   ```

   Check the version, release heading, retained historical releases, and notes.
   For npm, only the top-level and root-package lock versions change; dependency
   resolutions are retained. Bun's text lock does not store the root package
   version and remains byte-for-byte unchanged. The JSON files may be reformatted.
   No lockfile refresh or package-manager command runs during preparation: there
   is no install, network access, lifecycle execution, build, or hook installation.

6. Run your [library package checks](check-library-package.md) before deciding to
   publish. Review any extra artifacts those checks produce separately. After
   review, follow [Publish a prepared release to Git](publish-library-release.md)
   to explicitly commit, tag, and atomically push the release. Registry publication
   remains separate. `release:prepare` never stages, commits, tags, or pushes.
   Do not use the unreleased `changelog` command to overwrite prepared notes.

   Preparation records the baseline commit, branch, derived tag, and SHA-256
   fingerprints of the package, applicable lockfile, notes, and policy in the
   worktree's Git metadata at `git rev-parse --git-path drop-calf-release.json`.
   This local receipt is not staged or pushed and changes no Git refs or index.
   Keep it for publication; do not edit it. Publication rejects changes to these
   files after preparation. If changes are needed, restore the clean baseline,
   make and commit the owner changes, and prepare and review again.

## Recover or repeat preparation

If preflight, version derivation, or changelog rendering fails, fix the reported
problem and rerun. These failures occur before release-file writes. If a disk
error or interruption occurs during the final writes, inspect all release files;
those writes are not a multi-file transaction.

To abandon partial or unwanted preparation, first preserve any wanted edits, then
restore only the release files from the clean baseline. For an npm repository:

```sh
git restore -- package.json package-lock.json CHANGELOG.md
```

For Bun, restore `package.json` and `CHANGELOG.md`; the helper does not modify
`bun.lock`. Rerun only after the tree is clean.
A successful preparation leaves a dirty tree and rerunning is rejected without
changing it. Committing the prepared files without adding new release history
still produces the same non-advancing version and is rejected rather than
advancing twice or duplicating notes.

Drop Calf update maintains the `release:prepare` and `release:publish` scripts and
their `scripts/release-prepare.ts` and `scripts/release-publish.ts` helpers as policy.
Do not customize those helpers in place; update replaces them. The `changelog`
capability alone supplies the git-cliff pin and seeds the owner-managed
`cliff.toml`. Update does not prepare releases, and
standalone `library-release` validation is an explicit no-op, not a substitute for
this procedure.
