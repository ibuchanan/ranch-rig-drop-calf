# Adopt Drop Calf in an existing repository

<!-- cspell:words ibuchanan -->

Use this guide when a repository already has `.atlassian/OWNER` or other
signs of partial Drop Calf setup, but lacks `catalog-info.yaml`. This includes
projects initialized by an older, partial version of Drop Calf. Work in the
target repository; you do not need to check out Drop Calf's source. Use the
catalog [template](../../templates/catalog/catalog-info.yaml) and this guide
from the same Drop Calf revision that you run with Dagger.

`init` and `init-changes` are for first-time setup. Do not delete or temporarily
move a guard file to make them run: init can clean scaffold files and replace
owner content. `update` does not create the catalog or restore init-only files.
1. **Inspect the repository before editing.** Record its current Git status and
   review `package.json`, `.atlassian/OWNER`, `LICENSE`, `manifest.yml` (for a
   Forge app), and any existing `catalog-info.yaml`. Choose the correct profile
   (`forge-app`, `library`, `tool`, or `agent-skill`). Keep unrelated work out of
   the adoption diff. If these files disagree about ownership, name, or license,
   resolve the discrepancy with the project owner rather than guessing.

2. **Create the root `catalog-info.yaml` if it is missing.** Start with the linked
   template, or use the following minimal Component entity. Replace every example
   value with evidence from this repository:

   ```yaml
   apiVersion: backstage.io/v1alpha1
   kind: Component
   metadata:
     name: existing-app
     title: Existing App
     description: Existing app description
     annotations:
       forge-ranch/package-name: existing-app
       forge-ranch/license: Apache-2.0
       forge-ranch/copyright-date: "2024"
   spec:
     type: forge-app
     lifecycle: experimental
     owner: user:default/staff-id
   ```

   Use `package.json`'s actual name for `forge-ranch/package-name` (including
   its scope, if present), not the sanitized Backstage `metadata.name`. Set
   `metadata.title` to the project's display name and `spec.type` to the
   selected profile. Confirm the staff ID with `.atlassian/OWNER`; `spec.owner`
   must be a user reference such as `user:default/staff-id`. Choose the real
   lifecycle rather than assuming `experimental`. Use the existing license and
   copyright history to choose metadata: the current OSS update supports only
   `Apache-2.0`, and `forge-ranch/copyright-date` must be a year or ordered year
   range (`YYYY` or `YYYY-YYYY`). Do not silently replace a different license or
   advance an older project's copyright year to the present. If a catalog
   already exists, review its values instead of replacing it; update leaves it
   owner-managed. For field meanings, consult the
   [shared metadata contract](../../specs/02-project-functions.md#shared-metadata-contract).

3. **Preview the update without exporting it.** From the target repository root,
   run the same profile and optional capability selection you intend to keep:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf update \
     --directory . --profile forge-app changes --from . as-patch contents
   ```

   Replace `forge-app` if needed. The patch compares the updated Dagger directory
   with your current directory, including the catalog you just wrote. Stop and
   resolve any input error; do not work around one by rerunning init. Review all
   changed paths against the
   [capability reference](../../specs/02-project-functions.md#capability-verb-reference).
   In particular, update derives package identity from the catalog, replaces
   `.atlassian/OWNER` and the pinned OSS documents other than `README.md`, and
   can replace `.nvmrc` and `.npmrc`. It does not seed missing init-only
   documents, configs, or source conversions. Decide explicitly how to adopt
   any missing init-only assets; do not assume a successful update means the
   project matches a fresh init.

4. **Apply only after reviewing the patch.** Export the changeset rather than
   using directory export with `--wipe`:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf update \
     --directory . --profile forge-app changes --from . export --path .
   git diff --check
   git status --short
   git diff
   ```

   Review the new, untracked catalog separately; plain `git diff` does not show
   untracked files. If your project uses a lockfile, reconcile dependencies with
   its package manager deliberately: Drop Calf does not install packages or
   update the lockfile. When adopting the script-family lint workflow in a project
   generated before it was introduced, add its runner before running checks:

   ```bash
   bun add --dev --exact npm-run-all2@8.0.4
   ```

   Update enforces `scripts.lint` but does not add an undeclared seed dependency.
   Existing `lefthook.yml` files remain owner-managed; the old custom `lint`
   group is no longer used by `scripts.lint` and can be removed after review.

5. **Validate and check the project.** Run Drop Calf's read-only validation for
   the same profile and selection flags, then the repository's own checks where
   available:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf validate \
     --directory . --profile forge-app
   ```

   Inspect each `failed` result and `skipped` reason in the JSON report; a
   successful CLI exit alone does not mean every capability passed. Forge lint
   validation needs the Forge email/token secret inputs described in the
   [README](../../README.md#set-up-a-new-forge-app), plus its dependencies.
   Validation checks tool acceptance, not policy parity or whether init-only
   assets were adopted. Review the final Git diff before committing.

If an AI coding agent is doing this work, ask it to show the proposed catalog
values, sources of evidence, unresolved owner decisions, missing init-only
assets, and the update patch **before** it exports or changes unrelated files.
