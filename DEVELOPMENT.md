# Developing Drop Calf

Drop Calf (`drop-calf`) is a TypeScript Dagger module with first-time init,
policy update, and read-only tool-acceptance validation. `init-changes` also
records scaffold deletions for export. The
[`specs/` documents](specs/00-drop-calf-overview.md) include future capabilities
as well as current implementation contracts.

## Set up a fresh clone

Install [Bun](https://bun.com), the
[Dagger CLI](https://docs.dagger.io/install/), and
[Podman](https://podman.io/docs/installation). Podman is the preferred local
container runtime for Dagger. On macOS with Homebrew, install the CLI tools
with `brew install podman dagger` (and install Bun separately).

After cloning, run these commands from the repository root. On macOS, Podman
uses a VM; initialize it once, then start it for each new session if it is not
already running:

```bash
podman machine init
podman machine start
podman info
```

Skip `podman machine init` if `podman machine list` already shows a machine;
skip `podman machine start` if it is already running. Before invoking Dagger,
set the runner host in your shell (or add this snippet to your shell startup
file). This uses the installed Homebrew Dagger version for the Podman engine
image:

<!-- markdownlint-disable MD013 -->
```bash
if [[ -x "$(command -v dagger)" && -x "$(command -v podman)" ]]; then
    version=$(brew list --versions dagger)
    if [[ -n "$version" ]]; then
        export _EXPERIMENTAL_DAGGER_RUNNER_HOST="image+podman://registry.dagger.io/engine:v${version#* }"
    fi
fi
```
<!-- markdownlint-enable MD013 -->

This snippet assumes Bash or Zsh and Homebrew. The export must be active in the
same shell that runs Dagger. Then install dependencies and load the module:

```bash
bun install
dagger call init --help
```

Loading the module generates its local SDK. If Dagger cannot connect, confirm
that `podman info` succeeds and that the runner host is set in the current
shell.

## Development loop

```bash
bun run test
bun run typecheck
bun run lint
bun run format:check
```

`bun run format` and `bun run lint:fix` modify files. The unit suite under
`tests/` runs without starting Dagger. To exercise the Dagger boundary without
writing generated files locally:

```bash
mkdir -p .scratch/tmp_rovo_empty
dagger call init --directory .scratch/tmp_rovo_empty \
  --profile library --owner tester --package-name sample entries
rmdir .scratch/tmp_rovo_empty
```

The CLI loads the module from `dagger.json` and may generate a local `sdk/`
directory (ignored by Biome). `tsconfig.json` resolves `@dagger.io/dagger`
through that generated SDK, so if type checking reports a missing
`sdk/index.ts`, load the module with `dagger call init --help` before retrying.

### End-to-end tests

The suites in `tests/e2e/` start Dagger and run real tools, so `bun test`
leaves them out (see `pathIgnorePatterns` in `bunfig.toml`). They need a
running Dagger engine and network access. Run them all with:

```bash
bun run test:e2e
```

Or run one suite:

```bash
bun test tests/e2e/init.e2e.test.ts --path-ignore-patterns='vendor/**'
```

| Suite | Notes |
|---|---|
| `init` | `init-changes` export from empty directories, all profiles and presets |
| `scaffold-typescript` | In-place export, compiler diagnostics, update preservation |
| `node` | Runtime normalization through a real init |
| `forge-manifest` | Credential-prerequisite reporting only, not authenticated acceptance |
| `docs` | Config loading only, not Markdown content |
| `package-check` | Controlled tarballs, lifecycle safety, checker failures, and default-build declaration compatibility |
| `library-release` | Disposable release repositories; requires Bun, Git, and the pinned git-cliff on PATH, no Dagger or network |
| `library-prepare` | Disposable local Git dependency, real build tools, and ESM/CommonJS consumption; requires npm and network access |
| `biome`, `evals`, `git-hooks`, `library-build`, `secrets`, `testing`, `typescript`, `vitest` | |

`forge-create` is excluded from `test:e2e` because it runs a real
`forge create`, which registers an app in your developer space. It stays behind
`DROP_CALF_E2E=1`:

```bash
DROP_CALF_E2E=1 bun test ./tests/e2e/forge-create.e2e.test.ts --path-ignore-patterns='vendor/**'
```

To check authenticated Forge lint acceptance, you need a credentialed
`dagger call validate` (see the [README](README.md)) against a registered app you
can access. A local fixture with an invented app ID is not enough. Bun runs the
pinned Forge CLI, so Forge warns that it does not recognize the Node version;
authenticated CLI compatibility has not been verified.

## Code layout

Each capability's policy is specified in
[§4 of the functions spec](specs/02-project-functions.md#4-the-functions) and
summarized by its `documentation` field (see
[Maintaining the capability reference](#maintaining-the-capability-reference)).
The module docblocks and tests are authoritative; this list only points to
where things live.

`src/` is grouped into three subpackages by role, plus the Dagger entry point.
The dependency direction is inward: `core/` names no capability, capabilities
import `core/` (and the `catalog` readers) but never each other, `composition/`
imports both, and `index.ts` imports `composition/` and `core/`. The layout and
its rules are recorded in
[ADR 0004](docs/adr/0004-source-subpackages.md).

Entry point:

- `src/index.ts`: Dagger `DropCalf` entry point (`init`, `initChanges`,
  `update`, `validate`).

`src/core/`, shared machinery that names no capability:

- `src/core/capability.ts`: the `Capability` contract and `noOp(reason)`.
- `src/core/project.ts`: `ProjectBlueprint` and Dagger directory rendering.
- `src/core/package-json.ts`: `package.json` assembly from capability
  contributions
  ([ADR 0002](docs/adr/0002-package-json-assembled-from-capability-contributions.md)).
- `src/core/templates.ts`: `templateTree`, ordered seed steps, and the shared
  `EVALS_TEMPLATE` path other capabilities detect.
- `src/core/tool-run.ts`: the containerized-tool runner and failure convention
  for validators.
- `src/core/versions.ts`: `TOOL_VERSIONS`, read from `pins/package.json`, plus
  non-npm pins.
- `src/core/errors.ts`: `ParseError` and `InvalidOptionsError`.

`src/composition/`, the one place that knows every capability:

- `src/composition/profiles.ts`: ordered capabilities, policy options, and
  scaffold steps per kind.
- `src/composition/scaffold.ts`: scaffold steps for fresh `forge create` output
  (preclean, TypeScript adoption).

`src/capabilities/`, one module per capability:

- `src/capabilities/aidev.ts`: shared init-only agent guidance with separate
  `templates/aidev/library` and `templates/aidev/forge-app` authored seeds.
- `src/capabilities/biome.ts`: Biome config, `.editorconfig`, and format/lint
  scripts.
- `src/capabilities/bun-testing.ts`: Bun test scripts.
- `src/capabilities/catalog.ts`: `catalog-info.yaml` and the metadata readers
  that other capabilities use.
- `src/capabilities/changelog.ts`: git-cliff config and the release changelog.
- `src/capabilities/clean-build.ts`: the `clean` script.
- `src/capabilities/docs.ts`: docs lint configs and Diátaxis starter documents.
  Both configs are dotfiles: Dagger's `glob` matches them, but a shell glob will
  not.
- `src/capabilities/evals.ts`: the optional Promptfoo toolchain.
- `src/capabilities/forge-ahead.ts`: Forge Ahead dependencies.
- `src/capabilities/forge-manifest.ts`: Forge manifest runtime and `forge lint`
  validation.
- `src/capabilities/git-hooks.ts`: Lefthook config and hook scripts.
- `src/capabilities/gitignore.ts`: `.gitignore` blocks (see
  [The generated `.gitignore`](#the-generated-gitignore)).
- `src/capabilities/library-build.ts`: tsdown config and the library build
  script.
- `src/capabilities/node.ts`: `.nvmrc`, `.npmrc`, `@types/node`, and the catalog
  license.
- `src/capabilities/oss.ts`: pinned OSS documents (see
  [Refreshing the pinned OSS templates](#refreshing-the-pinned-oss-templates)).
- `src/capabilities/package-check.ts`: library-only build-and-pack verification,
  strict Publint, and consumer declaration-resolution checks.
- `src/capabilities/package-metadata.ts`: catalog-derived package identity.
- `src/capabilities/prelint.ts`: Forge prelint dependencies and scripts.
- `src/capabilities/secrets.ts`: SecretSpec declarations and Forge variable
  helpers.
- `src/capabilities/size-limit.ts`: the Size Limit budget and script.
- `src/capabilities/typescript.ts`: tsconfigs and tsc scripts.
- `src/capabilities/vitest.ts`: Vitest config and scripts.

Repository Git workflows share containerized init and update logic:

- `src/core/repository.ts`: Dagger orchestration, recovery export, and publication.
- `src/core/repository-git.ts`: Bun-executed Git prepare, finish, recover, and
  publish stages; repository options and result types.
- `scripts/repository.ts`: local launcher, checkout preflight, and bundle delivery.
- `tests/core/repository-*.test.ts`: disposable repositories and bare-remote tests.
- `tests/e2e/repository.e2e.test.ts`: local launcher/container round trip.

Elsewhere:

- `templates/`: authored seed trees, one directory per capability.
- `pins/package.json`: exact npm tool pins (see
  [Refreshing tool pins](#refreshing-tool-pins)).
- `vendor/`: pinned upstream inputs.
- `scripts/`: refresh and documentation generators.
- `tests/`: unit tests under `tests/core/`, `tests/composition/`, and
  `tests/capabilities/`, mirroring `src/`; shared fixtures live in
  `tests/support/` and `tests/e2e/` holds the opt-in suites above.
- `specs/`: the overview, kinds, and functions contracts. Future work is in
  §7.2 and §14 of the overview.

To change generated output, edit the capability (or `src/core/project.ts`) in
`src/`, wire it into the intended profiles in `src/composition/profiles.ts`, add
a focused test, regenerate the capability reference, and run the checks above.
Keep project assembly testable without the engine; `renderToDirectory` is the
Dagger boundary.

## Maintaining the capability reference

Each capability's `documentation` names its tools or format, public links,
one-line purposes, and summaries of implemented verbs. Keep these summaries
beside the implementation when changing its policy. Do not document inactive
verbs separately: the renderer reads their exact `noOp(reason)` text.

`src/composition/profiles.ts` supplies kind membership and selection policy.
The renderer groups only rows whose capability name, selection, tools, and verb
descriptions
are identical; Bun/Vitest, privacy policies, Node engine policy, and size paths
stay distinct where behavior differs. The kind inventory preserves execution order.

After editing policy, descriptions, reasons, or profiles, regenerate the marked
blocks in README and both specifications, then check for drift:

```bash
bun run scripts/refresh-capability-docs.ts
bun test tests/capability-docs.test.ts
```

The script replaces only marked blocks, refusing missing, duplicated, or reversed
markers. The test compares the committed blocks with fresh output and rejects
missing tool information, missing active-verb summaries, or duplicated no-op text.
It does not infer prose from function bodies: reviewers still check active summaries
against behavior, backed by each capability's behavior tests. README contains the
consumer overview and collapsed reference; the functions spec contains detailed
policy reference; regeneration and contributor workflow belong here.

## Library package checks

Generated libraries expose `pack:check` separately from source tests and standalone
configuration validation. See [Check a library package](docs/how-to/check-library-package.md)
for the consumer workflow and the default build's extensionless declaration
resolution blocker. The `package-check` E2E suite uses controlled packages and the
real pinned checkers; it does not modify the reference Forge Ahead repositories.

```bash
bun test tests/e2e/package-check.e2e.test.ts --path-ignore-patterns='vendor/**'
```

## Library release preparation

The library-only `library-release` capability maintains `release:prepare` and
`templates/library-release/scripts/release-prepare.ts`, plus the separate
`release:publish` command and `scripts/release-publish.ts` helper. It reuses the
`changelog` capability's centralized git-cliff dependency and never owns its package
contribution or the owner's `cliff.toml`. Update only restores the helpers and
commands; standalone release validation executes neither preparation nor
publication.

See [Prepare a library release locally](docs/how-to/prepare-library-release.md)
for preparation, review, supported locks, and recovery. npm version-only lock
metadata is updated locally; Bun's versionless text lock is preserved. No lock
refresh, lifecycle command, Git publication, or registry publication runs.

The release E2E suite uses disposable repositories and requires Bun, Git, and
`git-cliff` at `TOOL_VERSIONS.gitCliff` on PATH. It needs neither Dagger nor a live
remote. It tests actual git-cliff policy, npm lock formats, a real offline Bun
lock checked with `--frozen-lockfile`, preflight diagnostics, repeat runs, and
unchanged Git refs/index. Controlled tool failures exercise render-before-write.

```bash
bun test tests/e2e/library-release.e2e.test.ts --path-ignore-patterns='vendor/**'
```

Git publication is a separate explicit maintainer action. See
[Publish a prepared library release to Git](docs/how-to/publish-library-release.md)
for required checks, destination input, permissions, atomic pushes, and recovery.
Preparation records exact outputs locally in Git metadata without changing refs
or index. Publication verifies that receipt, runs the existing `test`, `typecheck`,
and `pack:check` scripts, and stages only release outputs. Owner checks and Git hooks
remain trusted executable code; unexpected side effects stop publication.

The publication E2E suite adds local bare remotes and rejecting hooks to disposable
repositories. It never contacts live remotes or modifies reference libraries.

```bash
bun test tests/e2e/library-publish.e2e.test.ts --path-ignore-patterns='vendor/**'
```

## Seeded assets

`.gitignore` is a seeded asset, not a blueprint file: like the OSS and docs
trees, it is pinned outside `ProjectBlueprint`. Its capability declares
`vendor/gitignore` for `seedTemplates` to assemble into the rendered `Directory`.
That keeps assembly pure and testable, and means
`buildProject` does not produce `.gitignore` — a unit test asserting on generated
`.gitignore` content should assert on `buildGitignore` instead.

`templates/typescript/` holds the two TypeScript seed configs; `buildProject`
collects their template path, not their bytes. TypeScript owns both configs during
init and update. After all init dependencies are declared, update enforces the seed's
compiler settings with targeted JSONC edits, preserving unrelated options and comments.
Declared `vitest` adds modern local resolution and test/config includes to typecheck;
`tsdown` selects modern base resolution and includes its config in typecheck. Both
triggers combine, and removal restores the baseline owned settings. Missing configs
are recreated; no missing package or lockfile is created. Vitest no longer seeds a
competing typecheck config. Library-build alone owns the library build command.
See the exact owned settings in [the TypeScript policy](specs/02-project-functions.md#typescript).

Validation runs the selected compiler's `tsc --showConfig` for both files inside a
Node-baseline container with a read-only repository mount. It checks config acceptance,
not source correctness or baseline agreement; a source-free config can fail with
TypeScript's no-input diagnostic. `--showConfig` can tolerate recoverable syntax
errors, so this is not a strict JSONC syntax audit; update rejects malformed syntax.
Both missing configs skip, a partial pair fails, and package-based extends require
the dependency to be available in the supplied tree.
No dependency install for the repository or exported changes are performed.

```bash
bun test tests/e2e/typescript.e2e.test.ts --path-ignore-patterns='vendor/**'
```

Forge runs on Node, not Bun. Vitest matches that runtime, provides `vi.mock` for
`@forge/*` modules, and matches the Forge examples and architecture tests.
`library`, `tool`, and `agent-skill` use Bun's built-in runner, including for
scripts shipped with agent skills. Both Vitest packages are pinned together
through `TOOL_VERSIONS.vitest`.

Bun needs no dependency, config, or sample-test seed, so its capability init is
an explicit no-op. The update pass supplies and maintains `test`, `test:watch`,
and `test:coverage` with `--pass-with-no-tests`; freshly initialized projects
can run these workflows before owners add tests. Only those script keys are
replaced: other scripts, test sources, owner configuration, and lockfiles survive.
Bun capability validation is an explicit no-op because this capability owns no
runner configuration to validate; actual test execution belongs to the test workflow.
`bun test tests/bun-testing.test.ts` checks these policies and runs generated Bun
scripts against empty, passing, and failing suites without Dagger or network access.

The Vitest config starts from the OKF producer example's discovery exclusions.
It deliberately uses explicit imports instead of globals so app code does not
acquire implicit test APIs. The current prelint rule
`manifest-tests-use-vitest-globals` warns about this deliberate choice; explicit
imports are supported by Vitest and the integration tests verify them.
The typecheck overlay includes tests and the Vitest
config, with modern module resolution confined to local checks. Tests and test
config stay outside the Forge handler build. The existing pre-push lint group
includes `typecheck`, so broken tests block pushing as broken source does.

`bun test tests/e2e/testing.e2e.test.ts --path-ignore-patterns='vendor/**'` verifies real
Dagger-generated and initialized scaffolds. It needs an engine and network for
test-tool installation, but never registers or deploys an app.

`templates/changelog/cliff.toml` is seeded the same way, with one condition the
TypeScript tree does not need: only the kinds that ship a `changelog` script are
offered the policy, so `agent-skill` never receives a config it has no command
to read. Edit that file to change a release policy — its commit preprocessors
assume Atlassian headers such as `feat(kinds): NONE …`, which is the format this
repository writes, so a project that commits differently should replace the file
rather than have it rewritten.

`templates/changelog/CHANGELOG.md` is seeded alongside it, and it is the one
seeded file here that is output rather than input: the `changelog` script
regenerates it whole with `git cliff … -o CHANGELOG.md`. Two consequences.
First, the prose lives in the policy's `header` key, not in the Markdown —
anything written into the file by hand is erased by the next run. Second, the
seed is byte-identical to what the command renders before any release, so the
first run is a no-op rather than a surprise diff. Neither `-o` nor `--prepend`
is interchangeable here: `--prepend` stacks entries above the file's title and
duplicates them on every run, whereas `-o` is idempotent.

Changelog validation reads a repository rather than
the module source, so it needs a `Directory`, not a path, and it runs
git-cliff inside a container at the `TOOL_VERSIONS.gitCliff` pin. That
means it needs a live engine, which is why its tests fake `dag.container()`
rather than starting one.

Capability verbs are the test surface. Factories take only policy options
(a kind, a budget name, Forge credentials, `ownsBuild`), never tool versions:
pins come from `TOOL_VERSIONS`, and tests assert against it. Per-verb
functions stay module-private; tests reach them through `runUpdate`,
`validateCapabilities`, or `verb(capability, "update" | "validate")` from
`tests/capability-fixtures.ts` when a test needs a verb's direct result or
thrown error. Pure policy helpers and specialized seed steps (such as
`copyOssAssets`) may still be exported and tested directly. Ad hoc
`validate-*` functions on `DropCalf` route through `validateCapabilities` too,
so a tool failure reports `failed` rather than throwing.

A capability's blueprint init cannot read the module source. It declares
seed steps with source paths and deferred copy operations instead; update may
read pinned templates through Dagger when its authoritative policy needs them.
`init` executes those steps through `seedTemplates` in profile order. Catalog
rendering precedes OSS metadata substitution. SecretSpec owns TOML substitution
and helper modes; gitignore owns pinned block assembly and scaffold-rule retention.
The seeding entry point contains no profile or capability checks.

Standalone `copy-*` Dagger functions have been removed. Use `init` for first-time
seeding and `update` for maintenance; internal copy helpers implement capability
policy but are not independent Dagger operations.

`tests/capability-ownership.test.ts` records actual init assignments, seed writes,
and update mutations and requires one owner per generated file or package field.
Scripts and dependency keys are checked individually, not as a whole package.
Update probes share a stale input so identical policy values cannot mask two
owners. Owner-supplied source, app identity, and initial seed inputs are not
separate generated outputs.

Every kind's `biomeToolchain()` declares `templates/biome`. Generation seeds its
`biome.jsonc` verbatim, without invoking a local Biome binary or creating a
host temporary directory. The template's `$schema` must match
`TOOL_VERSIONS.biome`; the test suite checks for drift. Edit the pinned template
to change the initialization baseline rather than rebuilding it in code.
The seed explicitly excludes `specs` and `dist` (including nested directories)
from Biome scans, independent of `.gitignore`. After init, the config is
owner-managed: update does not enforce these exclusions. It enforces the four
scripts, keeps Biome fresh, and runs the pinned `biome migrate --write` inside a
container for an existing root `biome.json` or `biome.jsonc`. Only that config is
copied back; Biome preserves settings/comments while migrating obsolete options.
Missing configs stay absent, referenced/nested configs are not migrated, and
`.editorconfig` stays owner-managed after init. Lockfiles are not refreshed.

Validation loads the root config and its references using pinned Biome with a
read-only repository mount. Formatting, linting, and assists are disabled, so
source-code failures do not become configuration failures. Missing config is
skipped; invalid config or unavailable references retain Biome's diagnostic.
To exercise migration, owner preservation, idempotence, and read-only acceptance
against real Dagger containers without registering or deploying an app:

```bash
bun test tests/e2e/biome.e2e.test.ts --path-ignore-patterns='vendor/**'
```

`templates/biome/.editorconfig` is the only EditorConfig source for generated
repositories. Capability init seeds it verbatim. The
seeded source survives rather than the generated text so editor settings remain
reviewable beside the formatter config, without a second definition or a seeding
exception. Only `[*]` defaults and the Markdown override remain; file-specific
sections that repeated those defaults were removed.

Markdown keeps trailing whitespace because two trailing spaces encode a hard
line break. The docs template leaves markdownlint's MD009 at its default, which
allows two-space hard breaks while rejecting other excess trailing whitespace.
Editors therefore preserve meaningful spaces, and `lint:docs` checks their use.

To exercise docs config loading, malformed configs, unavailable references, and
read-only acceptance without linting or fixing Markdown content:

```bash
bun test tests/e2e/docs.e2e.test.ts --path-ignore-patterns='vendor/**'
```

## Refreshing tool pins

`pins/package.json` lists the exact npm versions Drop Calf seeds; it is never
installed. `src/core/versions.ts` reads it into `TOOL_VERSIONS` and also holds
the pins that are not npm packages (Bun image, fnm, Node major). Dependabot opens
weekly pull requests against `/pins`; to check locally, run:

```bash
bun run pins:outdated
```

To upgrade only the pins you have reviewed, filter `npm-check-updates` by package
name; do not sweep intentional compiler/runtime pins along with tool updates:

```bash
bunx npm-check-updates --packageFile pins/package.json --filter 'cspell,lefthook' -u
```

For paired tools (such as `size-limit` and `@size-limit/file`), update their
shared pin together. After changing a pin, run `bun test --update-snapshots` and
review the diff. Validate affected tool workflows before adopting the new pin
in generated repositories.

On update, freshness raises declared dependencies that are behind a pin to it,
never downgrades, and skips GitHub references.

## The generated `.gitignore`

`src/capabilities/gitignore.ts` assembles `.gitignore` from the gitignore.io
templates in `GITIGNORE_TEMPLATES` (`visualstudiocode`, `linux`, `macos`, `windows`,
`node`, and `turbo`), de-duplicating rules on first occurrence, then appends
`ADDITIONAL_IGNORES`: `.fallow/`, `.scratch/`, `.session/`, and
`/.cocoindex_code/`. The internal gitignore seed helper selects a subset by
gitignore.io name; the default is all of them, and an unknown name fails before
anything is written. The generated URLs record the selected subset, not every
available topic in the pin.

The topic block uses Toptal's `# Created by <URL>` / `# End of <URL>` markers.
Additional defaults use a separate `# Created by drop-calf additional ignores` /
`# End of drop-calf additional ignores` block. Init and explicit copy seed missing
blocks while preserving existing owner content. Update regenerates complete
recognized blocks using their URL topics; everything outside is preserved
byte-for-byte, including rule order and `!` exceptions. Missing files or blocks
remain absent on update. Incomplete or mismatched markers fail before writing;
legacy generated files without an end marker need that boundary marked explicitly.

The standalone `yarn` topic is retired and removed from recorded selections on
update; Yarn-related rules included in upstream's Node topic remain. No blanket
`vendor/` ignore is generated. Validation explicitly skips: testing whether chosen
paths are ignored would enforce policy, not check Git's acceptance.

### Refreshing the pin

`vendor/gitignore` holds the gitignore.io response that
`src/capabilities/gitignore.ts` assembles from, so generation never depends on
the network. Refresh it
deliberately and read the diff, because upstream templates change without
notice:

```bash
bun run refresh:gitignore
```

Edit `GITIGNORE_TEMPLATES` in `src/capabilities/gitignore.ts` to change which
templates are pinned, then refresh. Two things will bite you if you skip the
script: the macOS
template contains a rule that only matches with its literal CR bytes, so an
editor that normalises line endings silently breaks it, and `.gitattributes` pins
the file to `-text` to stop Git doing the same. Tests read the real pin, so a
refresh that changes output shows up in the `gitignore.test.ts` snapshot.

## Refreshing the pinned OSS templates

OSS files are updated authoritatively from the pinned `vendor/oss-templates` tree. Refresh
the pin with `bun run refresh:oss`; OSS never fetches upstream during init or update.
The refresh script is explicit and manual, not part of `dagger call init` or
`dagger call update`.

`vendor/oss-templates` holds the `OSS_ASSETS` from Atlassian's private
`oss-templates` Bitbucket repository, and `.upstream` records the commit they
came from. They are plain tracked files, not a submodule: when Dagger loads the
module from a Git ref it initializes every submodule, and the engine has no
credentials for a private repository. Refresh with your own Git credentials and
read the diff:

```bash
bun run refresh:oss
```

The script refuses to pin if upstream gains a template that `OSS_ASSETS` in
`src/capabilities/oss.ts` does not list; add it there (and to
`transformOssTemplate` if it needs substitutions), then refresh.
