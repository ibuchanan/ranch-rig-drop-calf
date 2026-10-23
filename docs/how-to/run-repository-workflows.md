# Run repository Git workflows

Use `init` and `update` to create recoverable Git history around Drop Calf's
file transformations. Install Bun, Git, and Dagger first. Run only against trusted
repositories and modules; initialization tools can execute code from the project.

## Initialize or update locally

From your Drop Calf clone, initialize a scaffold outside any parent Git repository:

```bash
bun run scripts/repository.ts init \
  --directory /absolute/path/to/app --profile forge-app --owner your-staff-id
```

The launcher reads your Git `user.name` and `user.email`. Alternatively, pass
`--author-name` and `--author-email`. A fresh scaffold gets a baseline commit,
then a second commit containing the initialization. Existing history is preserved.
An existing repository must have a clean index and worktree and an attached branch.

Run subsequent updates with:

```bash
bun run scripts/repository.ts update \
  --directory /absolute/path/to/app --profile forge-app
```

The container creates an update branch, commits the changes, and merges with
`--no-ff`. The launcher imports that history and fast-forwards the local branch;
it does not replace `.git`, change remotes, or remove ignored local files. A no-op
update creates no branch or commits. Full history is required; submodules are not
supported. Container Git operations disable hooks and commit signing.

Add `--preview` to either command to retain `repository.bundle` and `result.json`
without applying changes to the checkout. The command prints their location.
Preview generation still runs the transformation in Dagger; it is not a sandbox
for untrusted project code. Review the diff with `git bundle list-heads`, fetch
into a disposable repository, and inspect its history.

Optional transformation arguments include `--preset`, repeated `--with-functions`
and `--without-functions`; init also accepts `--package-name` and `--description`.
The current scaffold package name takes precedence over the directory basename.

## Call Dagger directly

Without `--git`, the existing `init`, `init-changes`, and `update` calls remain
file-only transformations. With `--git`, `init` and `update` return a directory
containing `repository.bundle` and `result.json`, not the transformed worktree.

For a fresh scaffold:

```bash
dagger -m "$DROP_CALF_MODULE" call init \
  --directory "$APP_DIRECTORY" --profile forge-app --owner "$OWNER" --git \
  --author-name "$GIT_AUTHOR_NAME" --author-email "$GIT_AUTHOR_EMAIL" \
  export --path "$ARTIFACT_DIRECTORY"
jq -e '.status != "failed"' "$ARTIFACT_DIRECTORY/result.json"
```

For local history, create a full bundle and pass `--history /path/to/input.bundle`
and `--target-branch main`. The directory input can be empty when a bundle or
remote URL is supplied; never pass `.git` as directory content. The local launcher
handles bundle creation and delivery for you.

## Publish an update from CI

Set `DROP_CALF_MODULE` to a reviewed, immutable module revision, such as a full
commit SHA, not a moving branch. Supply a credential-free HTTPS repository URL,
the target branch, author identity, and an authorization header as a Dagger Secret.
The header value includes `Authorization: Bearer ...` or `Authorization: Basic ...`
as required by your provider; a raw token is not a complete header.

```bash
mkdir -p empty-input
dagger -m "$DROP_CALF_MODULE" call update \
  --directory empty-input --profile forge-app --git \
  --remote-url "$REPOSITORY_URL" --target-branch "$TARGET_BRANCH" \
  --author-name "$GIT_AUTHOR_NAME" --author-email "$GIT_AUTHOR_EMAIL" \
  --auth-header env:DROP_CALF_AUTH_HEADER --publish \
  export --path update-result
jq -e '.status != "failed"' update-result/result.json
```

Omit `--publish` to export a remote preview without pushing. CI's detached checkout
is irrelevant: the container clones the remote and checks out the explicit target.
Fetching and publishing bypass the task cache. Git publication pushes the retained
update branch first, then the target branch, without force. If the target advances,
the task stops; rerun against the new HEAD. Concurrency controls reduce duplicate
runs but do not replace Git's push protection.

Publication and transformation failures after baseline preparation produce a
`failed` result with a recovery bundle. Always check `result.json` after export:
exporting recovery artifacts can succeed even though the workflow failed. Failures
before baseline preparation, such as authentication errors, fail the Dagger call.
Preserve artifacts even on CI failure. A failed push can have succeeded remotely
before the client lost its connection; inspect remote refs before retrying.

### GitHub Actions

This job assumes Dagger is provisioned on the runner. Configure repository variables
`DROP_CALF_MODULE` (immutable revision), `DROP_CALF_AUTHOR_EMAIL`, and
`DROP_CALF_TARGET_BRANCH`. Restrict automated triggers to trusted code and actors.

```yaml
name: Update project tooling
on:
  workflow_dispatch:
  repository_dispatch:
    types: [drop-calf-updated]
  schedule:
    - cron: "0 6 * * 1"
permissions:
  contents: write
concurrency:
  group: drop-calf-update
  cancel-in-progress: false
jobs:
  update:
    runs-on: self-hosted # Git and Dagger already installed
    env:
      DROP_CALF_MODULE: ${{ vars.DROP_CALF_MODULE }}
      TARGET_BRANCH: ${{ vars.DROP_CALF_TARGET_BRANCH }}
      GIT_AUTHOR_NAME: Drop Calf automation
      GIT_AUTHOR_EMAIL: ${{ vars.DROP_CALF_AUTHOR_EMAIL }}
      GH_TOKEN: ${{ github.token }}
    steps:
      - name: Update and publish
        shell: bash
        run: |
          set -eu
          encoded=$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)
          export DROP_CALF_AUTH_HEADER="Authorization: Basic $encoded"
          mkdir -p empty-input
          dagger -m "$DROP_CALF_MODULE" call update \
            --directory empty-input --profile forge-app --git \
            --remote-url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git" \
            --target-branch "$TARGET_BRANCH" \
            --author-name "$GIT_AUTHOR_NAME" \
            --author-email "$GIT_AUTHOR_EMAIL" \
            --auth-header env:DROP_CALF_AUTH_HEADER --publish \
            export --path update-result
          jq -e '.status != "failed"' update-result/result.json
```

Add your approved artifact-upload step with an always-run condition. Bots need
permission to push both refs; branch protection or required signed commits may
prevent direct publication. This workflow does not create pull requests.

### Bitbucket Pipelines

Use a runner image with Git, Dagger, and jq already installed. Define secured
`DROP_CALF_AUTH_HEADER` with your provider's complete Authorization header, plus
`DROP_CALF_MODULE`, `TARGET_BRANCH`, `GIT_AUTHOR_NAME`, and `GIT_AUTHOR_EMAIL`.
Configure a scheduled pipeline or external upstream trigger for the custom job.

```yaml
pipelines:
  custom:
    update-tooling:
      - step:
          name: Update project tooling
          script:
            - mkdir -p empty-input
            - >-
              dagger -m "$DROP_CALF_MODULE" call update
              --directory empty-input --profile forge-app --git
              --remote-url "https://bitbucket.org/${BITBUCKET_REPO_FULL_NAME}.git"
              --target-branch "$TARGET_BRANCH"
              --author-name "$GIT_AUTHOR_NAME" --author-email "$GIT_AUTHOR_EMAIL"
              --auth-header env:DROP_CALF_AUTH_HEADER --publish
              export --path update-result
            - jq -e '.status != "failed"' update-result/result.json
          artifacts:
            - update-result/**
```

For SSH instead of HTTPS, use a credential-free SSH URL, `--ssh-agent` pointing
to your agent socket, and `--known-hosts` pointing to a reviewed host-key file.
Host verification is mandatory. Do not put credentials into remote URLs or YAML.

## Recover from a failed or unwanted update

Keep the printed recovery directory. Inspect `result.json` and the bundle before
importing anything. No automatic reset, stash, cleanup of failed results, or
force-push is performed. To inspect a bundle in a disposable repository:

```bash
git clone --branch main /path/to/repository.bundle inspection
```

To undo a successful update merge on your target branch:

```bash
git revert -m 1 <merge-commit>
```

Git remembers the reverted merge's ancestry. Merging the same update branch again
will not reapply its changes. Either revert the revert, or create a new branch from
the current target and cherry-pick the update commit, revise it, then merge it.

Before init, review ignore rules and secrets. The filename guard rejects common
credential paths but is not a secret scanner, and already-tracked credentials
remain in existing history. The retained bundle contains repository history;
treat it with the same access restrictions as the source repository.
