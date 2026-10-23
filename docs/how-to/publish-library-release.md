# Publish a prepared library release to Git

Use this procedure after [preparing and reviewing a library release](prepare-library-release.md).
This publishes a Git commit and tag, not an npm package. It never changes `private`
or invokes registry publication.

## Check permissions and preconditions

1. Use Bun and Git from the repository root. Install development tools separately;
   publication never installs tools or refreshes a lockfile. Obtain permission to
   push both the intended branch and a new release tag. The server must support
   atomic pushes and its branch protections and hooks must permit the release.

2. Obtain full history and tags, finish any Git operation, and check out the same
   branch on which preparation ran. Keep its baseline commit and the local
   preparation receipt in Git metadata. Do not commit prepared files yourself or
   edit the receipt. Older preparations without a receipt must be abandoned and
   repeated with the updated helper.

3. Review `git status --short` and the release diff. Only `package.json`,
   `CHANGELOG.md`, and the applicable `package-lock.json` or `bun.lock` may have
   staged or unstaged modifications. Staged content must equal the prepared
   working file, not an unrelated or partially staged edit. All release files and
   `cliff.toml` must still exactly match preparation. Unrelated tracked or untracked
   changes, deletions, renames, symlinks, and unsupported status entries are rejected.
   Ignored build artifacts are allowed and are never staged by the helper.

4. Select a configured remote name and an explicit branch. No `origin`, `main`,
   upstream, or alternate destination is assumed. For example, inspect a remote
   named `releases` and a branch named `stable`:

   ```sh
   git branch --show-current
   git remote get-url --push --all releases
   git ls-remote --refs releases refs/heads/stable 'refs/tags/*'
   ```

   Require exactly one push URL. If fetch and push URLs differ, inspect the push
   URL with `git ls-remote --refs <push-url>` instead. The helper reads and pushes
   the resolved push URL, not the fetch URL. The remote branch must already exist
   and exactly equal the preparation baseline: publish other commits and prepare
   again if necessary. Any local or remote release tag with the same version
   (with or without a `v` prefix) is rejected.

## Publish deliberately

1. Review the owner-managed `test`, `typecheck`, and `pack:check` scripts and their
   lifecycle hooks. All three scripts are required and run, in that order, before
   helper staging, commits, tags, or pushes. `pack:check` delegates to the existing
   package-check capability; publication does not duplicate its implementation or
   rely on an installed pre-push hook. These trusted repository commands can build,
   pack, run lifecycle hooks, access the network, or otherwise have side effects.
   A failing check stops publication and preserves its diagnostic. Missing scripts
   must be restored before preparing. Checks must leave prepared files and Git
   state unchanged; inspect any side effects on failure.

2. Invoke publication explicitly, replacing the destination with your reviewed
   remote and branch:

   ```sh
   bun run release:publish --remote releases --branch stable
   ```

   Publication verifies the receipt and remote refs, runs checks, then rechecks
   files, index, HEAD, and remote refs. It stages only the three documented release
   outputs (Bun's versionless lock remains unchanged), creates
   `chore(release): prepare for <tag>`, verifies its tree and parent, and creates
   a lightweight version tag. Commit hooks and signing configuration remain
   active; unexpected hook changes stop publication before tagging or pushing.

   The helper atomically pushes exactly the release commit to the named branch
   and the version tag to the resolved push URL, without force or extra followed
   tags. It does not amend history, replace tags, fall back to another destination,
   or retry without atomicity. Preparation, capability update, and standalone
   release validation never invoke this command automatically.

3. Confirm the success message and remote refs. Registry publication is a separate
   authorized operation; a successful Git release does not mean the package is on
   npm. Never relax package privacy as part of this workflow.

## Recover from failure

Do not delete evidence, force-push, reset history, or rerun preparation blindly.
The helper performs no destructive automatic rollback.
- **Before staging:** correct the reported precondition and retry publication if
  the same prepared baseline and outputs remain valid. Restore or preserve any
  unrelated work separately. If release files or policy need edits, abandon
  preparation using the scoped restore procedure, commit owner changes, and
  prepare and review again. The receipt is overwritten by the next successful
  preparation; it is not a release authorization or tamper-proof record.
- **During staging or commit:** staged release files may remain. Inspect
  `git status`, `git diff --cached`, and `git log -1`. Fix signing, identity, or
  hook failures. If HEAD still equals the preparation baseline and staged files
  match the prepared files, retry publication. If a hook created or changed a
  commit, inspect it and recover manually; publication will not amend it.
- **After commit or tag:** the local release commit and possibly its tag remain.
  Rerunning publication rejects the changed HEAD or existing tag rather than
  creating another release. Inspect the parent, tree, tag, and remote refs.
  If the commit exists but the tag does not, create the expected tag manually only
  after verifying the reviewed release commit. Do not move or overwrite an
  existing tag.
- **During push:** an explicit server rejection under atomic push updates neither
  remote ref. A transport failure can leave the outcome unknown: the server may
  have applied both refs before the connection failed. Query the resolved push URL
  before deciding what to do. If both refs point to the verified release commit,
  Git publication has completed. If neither changed, resolve the server failure,
  rerun the required checks, review the existing local commit and tag, and retry
  only the push. For example, after verifying that HEAD is still that exact commit:

  ```sh
  git -c push.followTags=false push --atomic releases \
    HEAD:refs/heads/stable refs/tags/v0.2.0:refs/tags/v0.2.0
  ```

  Inspect the push URL again before a manual retry. If one ref differs or remote
  history advanced, stop and coordinate with maintainers; do not force or overwrite
  refs. If the server lacks atomic-push support, use an atomic-capable destination
  or obtain an independently reviewed release procedure. The helper never silently
  falls back to two non-atomic pushes.

Drop Calf maintains both release commands and authored helpers as policy. Keep
custom release policy in `cliff.toml`; do not customize maintained helpers in place.
