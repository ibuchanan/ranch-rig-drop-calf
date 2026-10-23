# Project release capability and release tool

<!-- cspell:words dummyjson pipefail versionless lockfiles touchpoints -->

Status: **short-term implemented; long-term tool proposed**. Section 3
specifies the shared one-command release capability. Section 4 specifies the
future standalone tool; no tool dependency is installed yet. The package and
executable name `ranch-rig-release` is provisional and does not refer to an
existing published tool.

## 1. Scope and terminology

A **project release** records a project version in Git, including its release
notes, release commit, and immutable semantic-version tag. **Git publication**
pushes that commit and tag to a selected destination. Registry publication,
Forge deployment, and public changelog publication are separate effects; a
successful project release does not imply any of them.

Every newly generated `library`, `forge-app`, `tool`, and `agent-skill`
repository must expose `scripts.release`. The repository must be able to run
its installed release procedure without calling Drop Calf or Dagger. Updating
the installed procedure must be a reviewable repository change.

**One invocation performs the complete release:** checks, version and changelog
updates, commit, tag, and push. There is no mandatory preparation command,
manual review pause, publication command, or cross-invocation preparation
receipt. Running `release` authorizes the full Git operation; safety checks do
not require a separate human stage.

This specification covers a single repository and one version. Independent
workspace versions, release trains, npm publication, Forge deployment, and a
general-purpose plugin framework are out of scope.

## 2. Observed baseline

Inspected on 2026-10-23, before the shared capability implementation:
- Drop Calf selects `changelog` for all four kinds. It installs `git-cliff`,
  seeds `cliff.toml` and `CHANGELOG.md`, and maintains `scripts.changelog`.
  `cliff.toml` is owner-managed after initialization.
- Only `library` selects `library-release`. It maintains two TypeScript
  helpers and `release:prepare` / `release:publish`, but no `release` script.
  Preparation records a receipt; publication checks that receipt and atomically
  pushes the release commit and tag. Neither is registry publication.
- The peer `forge-ahead-*` libraries expose `release:prepare`, but those scripts
  actually bump package metadata, generate notes, commit, tag, and push. The
  proposed `release` name preserves their one-go workflow and describes it
  accurately; it does not introduce a prepare/review/publish split.
- For example, `forge-ahead-errors/scripts/release-prepare.sh` updates npm
  metadata, prepends notes, and pushes to hard-coded `origin main`.
  `forge-ahead-dummyjson/scripts/release-prepare.ts` does the corresponding
  Bun operation. Both packages are private; Git releases still apply.
- Peer tags predominantly use `vX.Y.Z`; `forge-ahead-atlassian-api-types` also
  has a historical unprefixed `0.1.0` tag. New tags must be canonical, without
  ignoring equivalent historical versions.
- Catalog metadata is not consistently present in the inspected peers.
  Drop Calf's catalog template has identity and lifecycle metadata but no
  release-version field. Catalog rollout must not block baseline releases.

The old [release preparation guide](../docs/how-to/prepare-library-release.md)
and [Git publication guide](../docs/how-to/publish-library-release.md) describe
legacy helpers retained in already-generated repositories. New repositories
use [Release a project](../docs/how-to/release-project.md); adoption of existing
repositories requires reviewing the update diff and old command removal.

## 3. Short-term: unified shared release capability

### 3.1 Peer convention contract

All four project kinds (`library`, `forge-app`, `tool`, `agent-skill`) use a
shared `release` capability that replaces the library-only predecessor. One
required `release` script invocation performs all steps: checks, version/changelog
updates, commit, tag, and atomic push to `origin main`. No flags, no interactive
checkpoint, no subcommands.

**Key requirements:**
- `bun run release` executes complete release in one invocation, no `--help` or
  override flags.
- Checks for checked-out `main` and a clean worktree. Complete history and
  release tags are maintainer prerequisites, not custom script audits.
- Run kind-selected `npm/bun run release:check` for automated verification.
- Derive version from `git cliff --offline --no-exec --bumped-version`, normalize
  `v` prefix, render full `CHANGELOG.md` to temporary file.
- Update `package.json` version: npm uses `bun run --bun npm version`, Bun uses
  `jq` without modifying `bun.lock`.
- Stage only `package.json`, `package-lock.json` (npm only), and `CHANGELOG.md`.
- Commit as `chore(release): vX.Y.Z`, create annotated tag, push atomically to
  `origin main` with `git -c push.followTags=false push --atomic`.
- No flags, no help, no lockfile audits, no SemVer policy parsing, no remote
  preflight queries, no hook verification. Fail on errors; maintainer inspects
  and retries manually.

**Short-term boundary:** standalone Bash script, no TypeScript helper, no
concurrency lock, no automatic resume. Peer libraries keep visible command sequence.

### 3.2 Capability and package scripts

| Resource                                         | Init                              | Update                                         | Validation                                     |
| ------------------------------------------------ | --------------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `release`                                        | Policy contribution in every kind | Maintain the command                           | Never execute a release                        |
| `scripts/release.sh`                             | Copy authored templates           | Maintain as policy; not owner extension points | Syntax and behavior tests in isolated fixtures |
| `release:check`                                  | Seed per-kind checks              | Preserve owner changes                         | Report missing required command before release |
| `git-cliff` pin and `changelog` command          | Existing `changelog` ownership    | Existing freshness policy                      | Existing changelog validation                  |
| `cliff.toml`, release notes, versions, lockfiles | Existing owners                   | Release capability update preserves them       | No release-file writes on the host             |

No capability lifecycle operation may commit, tag, push, or announce a release.
An existing repository with a conflicting custom `release` script requires a
reviewed adoption diff, not a silent claim that its workflow is equivalent.
Owner-specific behavior belongs in declared checks or supported configuration,
not edits to policy-managed helper files.

Implementation touchpoints:
- Replace `src/capabilities/library-release.ts` with the shared capability;
  select it in every profile in `src/composition/profiles.ts`.
- Add the standalone Bash script under `templates/release`, without a
  TypeScript helper or the old two-command protocol.
- Extend `tests/composition/kind-outputs.test.ts` to require `release` for every
  kind. Update capability ownership tests and generated inventories.
- Adapt existing release tests for one invocation, npm and Bun, and all
  kind-specific check lists. Replace the two-stage guides when behavior ships.

Peer `release:prepare` scripts that currently push migrate to `release`, keeping
one-go behavior. Drop Calf's separate prepare/publish workflow migrates to the
same command through an explicitly reviewed adoption. Review each repository's
custom checks, lockfile format, changelog history, and tag convention first.
Resolve any in-progress old preparation before switching; never consume its
receipt as authorization for the new command. Remove superseded scripts and
helpers only after references are gone and the replacement is tested.

---

## 4. Long-term tool: `ranch-rig-release` (not implemented in v1)

The following specifies a future standalone release tool. Section 4 is **not
part of the short-term implementation**; it documents the desired long-term
contract and evolution. The shared Bash script (section 3) satisfies all near-term
needs. The tool proposal remains open for a future release that can justify the
additional complexity and delivery cost.

### 4.1 Distribution and installation

The tool is an independently versioned `ranch-rig-*` repository. It is installed
in consuming repositories as a **devDependency**, never a runtime dependency,
Dagger module requirement, global install, or unpinned on-demand download.

The initial distribution should be a Git dependency pinned to an immutable
commit, consistent with existing ranch-rig tool usage but without a floating
branch. A published npm package with an exact version may replace it later.
The eventual address must be verified before adding a real pin; there is no
placeholder dependency to install now.

The package exposes a real `bin` entry named `ranch-rig-release`. A Bun source
entry point with a Bun shebang is sufficient for v1, given current generated
repositories already require Bun for developer workflows. It must be present
in an installed Git dependency without uncommitted build output, a submodule
bootstrap, consumer hook installation, or release-time downloads. A separate
binary distribution is not required for v1.

Drop Calf records the immutable tool reference in `pins/package.json`, exposes
it through `src/core/versions.ts`, and uses the existing dependency contribution
and freshness machinery. Git-pin changes require explicit reviewed updates;
the updater must not compare unrelated commit hashes as semantic versions.
Lockfiles are refreshed using the repository's existing manager and reviewed.
Updating a pin does not change a repository until that dependency update is
applied; lockfiles must not silently select a different procedure at runtime.

The consumer script becomes:

```json
{
  "scripts": {
    "release": "ranch-rig-release"
  }
}
```

No copied release implementation remains in the consumer. Drop Calf owns
installation and command wiring; the tool owns execution; the repository owns
policy and authorizes publication by running `release`.

`changelog` remains the sole owner of the direct `git-cliff` pin in v1.
The release tool resolves the consumer's installed git-cliff executable,
requires a supported version, and fails clearly if it is missing. It must not
silently use an unrelated global version. Git-cliff should only move into the
tool's own dependencies if the standalone `changelog` workflow is migrated at
the same time; avoid two independent version authorities.

### 4.2 Command interface

| Invocation                        | Contract                                                                                                                          |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| No arguments                      | Run the complete Git release using the configured upstream destination. Fail before mutation if destination resolution is unsafe. |
| `--remote <name> --branch <name>` | Run the same complete release against an explicit configured destination. Both arguments are required together.                   |
| `--help`                          | Usage only; no file writes, hooks, or network calls.                                                                              |

There are no `prepare` or `publish` subcommands and no mandatory human pause.
A plan/dry-run interface can be added when needed; it is not required for v1.
These commands do not change Drop Calf's `init`, `update`, or `validate` verbs.

Version selection uses git-cliff and `cliff.toml`; CLI overrides for prereleases,
explicit versions, or build metadata are deferred until a concrete repository
requires them. Stable tags are `vMAJOR.MINOR.PATCH`. Historical unprefixed tags
remain valid inputs and are checked for collisions. Git ref validation and
argument-array process invocation prevent option or shell injection.

The first release may equal the seeded `package.json.version` if no release tag
exists. A no-change release, duplicate candidate, or version below the package
version is rejected. From the second release onward, the candidate must exceed
the previous released version. A valid `0.1.0` seed must not make a newly
created project impossible to release.

### 4.3 Internal release stages

The tool owns one fixed sequence within a single invocation:
1. **Preflight:** validate repository, tools, version, package manager,
   destination, and any enabled integration prerequisites.
2. **Check:** run repository checks and confirm that HEAD, configuration,
   worktree, index, and destination still match the starting state.
3. **Generate:** render changelog, align package/lock metadata, and apply any
   explicitly enabled local metadata changes.
4. **Commit, tag, and push:** commit only declared outputs, verify the commit,
   create the immutable tag, and atomically push branch and tag.
5. **Announce, when supported and explicitly enabled:** publish approved public
   notes only after the destination confirms the release refs.

The stages are internal implementation boundaries, not separate commands or
approval gates. Baseline and output verification use in-process state; no
persisted preparation receipt or stale-preparation protocol is needed.
Reject concurrent invocations in the same worktree.

The tool retains all short-term safety requirements. Rendering failure must
leave existing release files intact. A multi-file write failure can leave
partial local output and must be diagnosed honestly; no claim of multi-file
filesystem atomicity is made. Failure diagnostics identify the stage, affected
files, commit/tag if created, and destination. Git refs and those diagnostics
provide recovery evidence without introducing a generic resumable workflow.

### 4.4 Repository policy and future local metadata

V1 requires no new configuration file: it reads `cliff.toml`, `package.json`,
the supported lockfile, the declared check script, and Git destination
configuration. The installed tool version selects the shared procedure.
Configuration is added only for a shipped, versioned feature, with validation
of unknown keys and no embedded credentials or executable configuration
discovery.

V1 does not read, validate, or modify `catalog-info.yaml`. Catalog support is
a subsequent built-in stage, not a v1 prerequisite:
- Disabled by default, including when `catalog-info.yaml` exists. Neither
  presence nor project kind alone authorizes a metadata rewrite.
- Once enabled, a missing or malformed catalog fails before mutation.
  Never invent the file during a release to hide incomplete rollout.
- Specify the exact owned annotation before implementation; a candidate is
  `metadata.annotations["forge-ranch/release-version"]`, containing the
  unprefixed semantic version. This is a proposal, not a Backstage standard
  or an existing catalog contract.
- Set that field during the internal generation stage and commit it with the
  release. Preserve comments and all unrelated catalog identity, owner,
  lifecycle, and annotations. Do not repurpose `spec.lifecycle` as a version.
- The tag and package version remain the release identity. A later Drop Calf
  update must not overwrite catalog release metadata with a seeded value.

There is no generic hooks API in v1. A new built-in stage is preferable to
shipping a plugin framework for two known future effects.

### 4.5 Future public changelog publication

Publishing to developer.atlassian.com is a separate, opt-in integration. No
endpoint, authentication mechanism, or public publishing permission is assumed
by this specification. Before implementing it, confirm the supported publishing
workflow/API, destination identity, schema, review/approval requirements,
credentials, and duplicate-detection capabilities. An eventual public-content
approval requirement must not retroactively impose a manual pause on the
baseline Git release workflow.

The integration must:
- Use separately approved public content; never assume internal Git commit
  messages or the complete repository changelog are safe to publish.
- Obtain secrets from the runtime environment or an approved secret provider,
  never committed configuration, command-line tokens, or diagnostic logs.
- Publish only approved content for an already verified remote release tag.
- Identify the entry by project, version, and destination; persist the returned
  identifier. Use platform idempotency support where available. On ambiguous
  outcomes, query that identity before retrying; if the platform cannot check,
  require manual reconciliation instead of claiming exactly-once delivery.
- Report announcement failure as **Git released, announcement incomplete**,
  return a nonzero result, and retain retry evidence. Never undo the Git release
  or create a second commit/tag in an attempt to repeat the announcement.

A dedicated retry command, for example `announce --tag <tag>`, is introduced
with the integration, not as a nonfunctional v1 command. It re-verifies the
release identity, approval, and content before retrying only the external
publication stage. Git atomic push cannot make an external website atomic.

### 4.6 Failure and recovery contract

- Before local mutation: fail with the path/ref, actual and expected value,
  and an actionable diagnostic; no release artifacts are changed.
- If checks fail, do not write release outputs, commit, tag, or push. Leave
  any check-produced files visible. A retry starts normally once the maintainer
  resolves the failure and restores the required clean starting state.
- After local writes: preserve owner work and report partial outputs. Do not
  pretend a second normal invocation can safely resume from a dirty tree.
  Cleaning up requires an explicit, scoped maintainer decision.
- If a commit hook fails or changes files, report the resulting index,
  worktree, and HEAD state; do not automatically amend or reset it. A pre-push
  hook rejection leaves local commit/tag evidence for a push-only recovery.
- After commit or tag creation: report exact local artifacts. Never blindly
  rerun the entire release, amend, move tags, or reset history.
- After a push transport error: the result is unknown until both remote refs
  are queried at the resolved push destination. Both matching means Git
  publication completed; neither matching permits an explicitly reviewed
  retry of the same refs after checks. A mismatch requires intervention.
- After an external announcement error: preserve the successful Git stage and
  retry only the failed external stage after resolving ambiguous outcomes.

Failures exit nonzero and report the completed stage and recovery guidance.
Recovery may require explicit maintainer Git operations; it is not a mandatory
second step in successful releases. Success reports Git publication, not
registry publication or deployment.

## 5. Acceptance criteria (short-term)

### Generator and distribution

- All four kinds emit a working `release` entry point. New repositories have
  no prepare/publish aliases, manual checkpoints, or preparation receipts.
- Init/update/validate never commit, tag, push, or change release artifacts.
- One capability owns release wiring; `changelog` alone owns its tool pin.
  Update is idempotent and preserves owner checks. Package-manager commands
  and staged-file lists are rendered at scaffold/update time, not detected
  during release.

### Release behavior

- One Bash invocation completes checks, version/changelog updates, commit, tag,
  and atomic push to `origin main` without flags or interactive approval.
- Disposable Git repositories with local bare remotes exercise npm and Bun,
  all four kinds, initial releases, and later patch/minor/major changes.
- Generated output preserves changelog history/header, updates only declared
  release files, keeps package/tag versions aligned, and leaves Bun lock bytes
  unchanged.
- Dirty/partially staged/untracked files, a branch other than `main`, and
  supplied arguments fail before release-file writes. Maintainers supply
  complete history, ordinary package files, and synchronized `origin main`;
  there are no custom audits for these prerequisites.
- Check failures block tagging/pushing. Commit/tag creation failures and
  transport errors have explicit diagnostics for manual recovery without
  automatic rollback.

## 6. Delivery boundaries and open decisions

1. **Short term:** ship universal wiring, one standalone Bash release script,
   per-kind checks, and tests. Do not add a tool dependency that does not exist
   yet. Replace the old public split workflow rather than requiring it.
2. **Tool v1:** extract the tested one-command procedure into the independently
   released package, prove installed-bin behavior, add an immutable pin,
   replace the Bash script entry point with the bin call, and remove the
   copied script.
3. **Later:** ship catalog support once annotation ownership is accepted, and
   public announcements only once the publishing workflow and approval model
   are verified. Neither is required to ship tool v1.

Open decisions before implementation:
- Confirm the tool's repository/package/bin name and initial release reference.
- Confirm the catalog annotation and public publishing workflow only when
  those stages are commissioned; do not make them blockers for v1.
