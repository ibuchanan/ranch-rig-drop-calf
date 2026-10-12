# Project-functions specification

High-level specification of the repository capabilities ("functions") Drop Calf
(`drop-calf`) must implement, originally extracted from the `vendor/init-repo`
design (`specs/esa-repo-init-spec.md`).

[ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md) supersedes the original
single-operation, universal-merge contract. The three-verb contract below is the
target; capability-specific migration tickets resolve detailed policies not yet
split into verbs. Existing policy details remain unless explicitly superseded.

## 1. Purpose

A **project-function** is a repository capability with a stable, project-facing interface
(npm scripts, files, hooks). Functions are selected individually or composed into named
project kinds (`library`, `forge-app`, `tool`, `agent-skill`). Each function may select
one or more **tools** (`biome`, `lefthook`, `git-cliff`, `vitest`, …); a tool is an
implementation choice, a function is the capability. Domain terms are defined in
[overview §4](00-drop-calf-overview.md#4-core-concepts).

## 2. Function contract

Every function:

- has a unique `name`;
- declares `dependsOn` and `conflictsWith` (edges in the function graph);
- **plans before mutating**: all operations (file edits, commands, installs, conflicts) are
  recorded in a plan builder first; untracked direct writes are forbidden;
- requires **`init`** for starting content and initial settings, **`update`** for
  policy-driven changes, and **`validate`** for read-only tool-acceptance checks;
- makes every inactive verb an explicit no-op with a non-empty, enumerable reason
  explaining why that capability has no work for that verb;
- makes **update idempotent**: the same inputs and policy produce no further
  changes on a second run; init is first-time setup, not a maintenance rerun;
- documents which outputs are init-only, updated authoritatively, or changed
  selectively within shared resources.

The capability contract contains only these three operations; `addTo`,
capability-level template declarations, and the expansion adapter are removed.
Init declares deferred template seed steps on its blueprint. Generic assembly
executes them in order; catalog rendering, OSS substitution, TypeScript exclusions,
gitignore blocks, and SecretSpec executable modes are owned by their capabilities.
Optional CLI selection is capability data, including default inclusion and whether
`--with` or `--without` is permitted. Profile assembly does not name capabilities
when selecting or executing them. Standalone `copy-*` Dagger actions are removed;
internal copy helpers remain implementation details of init or update.

Tests reject placeholder migration reasons and require exactly one capability
owner for every generated file, package field, script, and dependency key across
init, seed execution, and update. The README seed belongs to OSS; there is no
separate README generator.

### Scaffold source adoption (top-level init only)

On `forge-app`, top-level `init` automatically renames root `src/**/*.js` to
`.ts` and `src/**/*.jsx` to `.tsx`. A pure planner receives file paths and optional
manifest text; the Dagger boundary applies its plan. Matching `resources[].path`
scalars are updated, while function handlers without extensions and unrelated
manifest bytes are preserved. Destination collisions refuse initialization before
cleanup.
Source bytes remain unchanged; strict compiler settings are not relaxed and
newly exposed type errors require owner fixes. Custom UI `static/` packages and
other profiles are outside the conversion scope. An already-TypeScript tree
plans no changes. `init-changes` includes source deletions and additions for
review; `update` and standalone scaffold removal never run adoption.

## 3. Cross-cutting invariants

- **Intent determines mutation behavior.** File type and generic merge rules do
  not decide whether to seed, preserve, merge, or replace content. Mutation modes
  such as `create-if-absent`, whole-file replacement, `structured-merge`,
  `managed-region`, `copy-tree-if-empty`, and `executable-seed` are implementation
  techniques for the capability's documented policy.
- **Documented policy authorizes update.** Authoritative updates may replace
  owner edits without explicit opt-in or `--force`. A conflict is raised where
  the capability's policy requires one, not merely because content differs.
- **Script ownership is stable.** Only the owning function may replace its canonical npm
  script. Git-hooks alone owns `prepare`, `lint`, and `check`; prelint contributes
  only named lint subtasks.
- **Shared-resource scope is explicit.** Preserve content outside the capability's
  declared scope; preservation within it follows that capability's policy.
  Never create `package.json.orig`.
- **Versions are centralized** in one catalog-version registry; no function carries a
  duplicated version constant.
- **Seed assets are versioned authored content.** Update leaves init-only content
  alone; an authoritative policy may replace authored content from its pinned source.
- **Composition uses separate passes:** scaffold steps → every capability's init
  → every capability's update for top-level `init`; only the update pass for
  top-level `update`. Each pass follows the selected profile's order.
- **Validation is separate for now.** Neither mutation operation automatically
  invokes it. Top-level `validate` is independently usable without prior init or
  update and gives every validator the same fully composed repository. It reports
  validated, skipped with a reason, or failed. Any future automatic validation
  follows the complete mutation pass, never an intermediate shared-resource state.
- **Validation checks tool acceptance, not policy compliance.** An owner-edited
  configuration accepted by its consuming tool passes even if it differs from
  the baseline. Checks needed to apply changes safely remain mutation preconditions,
  not this repository-validation pass.

## 4. The functions

Default order (dependency/precedence graph may encode it via `before`/`after`):

```text
catalog → package-metadata → oss → gitignore → node → forge-manifest → changelog → secrets → format → forge-prelint
→ typescript → forge-ahead → aidev → test → evals (optional) → size → git-hooks
```

**Note:** Init sequence stages catalog init before OSS; within the init pass, capabilities run in listed order. The OSS capability depends on catalog being initialized first to read metadata.
Library's `library-build` capability precedes `typescript` so its restored tsdown
declaration selects compiler policy in the same update pass.
Forge's Vitest `test` capability precedes `typescript` in `src/profiles.ts` so its
updated dependency declaration is visible to compiler policy in the same pass.

### `catalog`

Seed a single root `catalog-info.yaml` Backstage Component entity with project metadata.
The file is initialized once from `templates/catalog/catalog-info.yaml`, with seed tokens
replaced by name, description, owner staff ID, and copyright year. The entity carries
optional annotations for package names and GitHub/Jira links (examples in template).

Under [ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md):

- **init** replaces seed tokens:
  - `[Catalog name]` → `metadata.name`: sanitized lowercase ASCII letters, digits, `.`, `_`, `-`; max 63 chars, alphanumeric start and end.
  - `[Project name]` → `metadata.title`: original project name, no sanitization.
  - `[Package name]` → annotation `forge-ranch/package-name`: original package name (e.g., `@scope/package`).
  - `[Description]` → `metadata.description`: project description or empty string.
  - `[Owner]` → `spec.owner`: `user:default/{staff-id}`, validated as entity reference format.
  - `[Project kind]` → `spec.type`: the selected profile kind (`library`, `forge-app`, `tool`, `agent-skill`).
  - `[Copyright date]` → annotation `forge-ranch/copyright-date`: YYYY or YYYY-YYYY (ordered range), captured once at init, never auto-incremented.
  - The template seeds `forge-ranch/license: Apache-2.0` as a literal annotation.
- **update** is an explicit no-op: the catalog module owns the whole file, but no update policy is currently defined. Update neither creates nor rewrites it.
- **validate** checks structural acceptance without policy compliance or remote reference lookup:
  - YAML syntax and duplicate-key detection.
  - Roadie schema validation via `@roadiehq/roadie-backstage-entity-validator`.
  - `kind` must be `Component`.
  - `spec.owner` must be a valid user entity reference.
  - `forge-ranch/copyright-date` annotation (if present): YYYY or YYYY-YYYY with ordered range.
  - Missing `catalog-info.yaml` → skipped with reason.
  - License annotations are structurally checked as strings, not required or
    compared to Apache-2.0; consumer mutation preconditions enforce their needs.

#### Shared metadata contract

The root `catalog-info.yaml` is the permanent source for metadata consumed by
other modules, independent of language or package manager. This tracked section
records the field contract; scratch tickets only track deferred wiring.

| Value | Catalog field | Consumer |
|---|---|---|
| Catalog identifier | `metadata.name` | Backstage; not a package or display name |
| Project display name | `metadata.title` | OSS README/CONTRIBUTING (ticket 06) |
| Description | `metadata.description` | Package metadata (ticket 04) |
| Responsible user | `spec.owner` | Package metadata author; OSS OWNER |
| Package name | `metadata.annotations["forge-ranch/package-name"]` | Package metadata (ticket 04) |
| Copyright year/range | `metadata.annotations["forge-ranch/copyright-date"]` | OSS LICENSE (ticket 06) |
| License | `metadata.annotations["forge-ranch/license"]` | Node package.json license; OSS template validation (ticket 06) |
| External-system pointers | Integration annotations and `metadata.links` | Jira/GitHub integrations |

Additional module-specific metadata belongs under `metadata.annotations` with
`forge-ranch/{key}` names and string values unless a standard Backstage field or
integration annotation already represents it. Add each new shared key and its
meaning here when a consumer needs it; do not invent unused metadata fields.
The catalog module owns the file; other modules read these values rather than
maintaining competing sources. Unrecognized annotations remain intact and are
accepted by structural validation. No catalog update policy is defined yet.

Annotations for Jira/GitHub links (examples in template) are not auto-populated; they
remain manual additions to the catalog entry. Copyright year is captured once at init;
update does not increment it. The `forge-ranch/license` annotation is seeded as a literal
string `Apache-2.0` at init and is consumed by `node` (for `package.json`) and
`oss` (for template validation); Apache-only templates fail if the catalog license does
not match. Standalone `validate-catalog` does not require `package.json`. Catalog
init receives the selected project kind from its capability composition.

### `package-metadata`

Own the base package fields `name`, `version`, `type`, `description`, `author`,
and `private`. Node pulls `license` from the catalog; scripts, dependencies,
publishing entry points, and all other package fields remain outside this
capability's scope.

| Field | Init | Update |
|---|---|---|
| `name` | Derive from `metadata.annotations["forge-ranch/package-name"]` | Replace from catalog |
| `description` | Derive from `metadata.description` | Replace from catalog; missing removes the package field, empty stays empty |
| `author` | Derive the staff ID from `spec.owner` | Replace from catalog; `user:default/tester` and `user:tester` both yield `tester` |
| `version` | Seed `0.1.0`, replacing scaffold metadata | Preserve; release tooling owns subsequent versions |
| `type` | Set `module` | Enforce `module` |
| `private` (`forge-app`, `agent-skill`) | Set `true`, overriding scaffold `false` | Enforce `true` |
| `private` (`tool`, `library`) | Set `true`, overriding scaffold `false` | Preserve the field, including `false` or absence, to permit later npm publication |

Catalog is the source of truth for shared identity on both init and update. Direct
package edits to `name`, `description`, and `author` are overwritten. Package names
are never inferred from `metadata.name` or `metadata.title`. The legacy `author`
argument is retained for CLI compatibility but ignored: author, OWNER, and catalog owner
refer to the same staff ID. OSS synchronizes OWNER independently.
Template rendering and scaffold merging finish before the update pass derives the
final package fields from the actual catalog bytes.

Update does not create a missing `package.json`. For an existing package it rejects
malformed/non-object JSON, missing or malformed catalog YAML, a missing/non-string/
blank package-name annotation, a non-string description, an invalid user owner
reference before writing. It does not
run full catalog validation as a mutation precondition. Valid syntax with values rejected
by npm is left to standalone validation. With unchanged owned fields, update preserves the
original file bytes. Otherwise it writes sorted, two-space JSON with a trailing newline,
preserving all unrelated field values. A second update changes nothing.

**validate** reads `package.json` through `npm-package-json-lint` using explicit
structural rules: name type/format, version type/SemVer format, description type,
private type, type type, and accepted `module`/`commonjs` values. A separate author
shape check accepts a string or an object with a string `name`; the linter has no
structural author-type rule. Missing optional fields are accepted. Malformed JSON
and non-object roots fail; a missing package is skipped with a reason. Validation
is read-only, uses no recommended/style preset or autofix, does not consult catalog,
and does not enforce policy (`module`, private packages, catalog identity, or
`0.1.0`). The linter is a pinned module dependency, not a generated-project tool.
This is a metadata acceptance check, not proof that npm install or publish succeeds.

### `oss`

Copy `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`,
`SECURITY.md`, and `.atlassian/OWNER` from the pinned `vendor/oss-templates` tree,
substituting only the required staff ID in OWNER, `[Project name]` in CONTRIBUTING
and README, and `[YYYY]` in LICENSE; preserve all other template bytes. `DEVELOPMENT.md`
is generated separately because it is not in that template. The OSS capability
declares a `PINNED_OSS` template source and is selected after `package-metadata`
and before `node` in the initialization order.

Under ticket 06's agreed policy:

- **init** seeds all six files (`LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  `README.md`, `SECURITY.md`, `.atlassian/OWNER`) from templates
  with catalog-driven substitution:
  - `metadata.title` → project name in README and CONTRIBUTING
  - `metadata.annotations["forge-ranch/copyright-date"]` → `[YYYY]` in LICENSE (not
    auto-incremented; capture once and preserve)
  - `spec.owner` → staff ID in `.atlassian/OWNER` (extract staff ID from
    `user:default/{staff-id}` format)
  - `metadata.annotations["forge-ranch/license"]` must equal `Apache-2.0` or init fails
  - All six files are rendered over the fresh seed directory. README remains
    init-only after initialization; update creates missing authoritative files.
- **update** is authoritative for `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  `SECURITY.md`, and `.atlassian/OWNER`, replacing owner edits whole-file without
  opt-in. README survives update (init-only). Update uses the same catalog-driven
  substitutions as init. Missing required catalog fields (`metadata.title`,
  `forge-ranch/copyright-date`, `spec.owner`, `forge-ranch/license`) cause update
  to fail. Mismatched or missing `forge-ranch/license` (not `Apache-2.0`) also fails.
  With unchanged content, update preserves bytes. A second update changes nothing.
- **validate** is an explicit no-op: these documents require manual inspection;
  no consuming validator checks their acceptance. Mutation preconditions check
  consumed catalog values without running full catalog validation.

OSS never changes catalog or package metadata. Missing or malformed consumed
values fail before asset writes. Owner references accepted by catalog, including
`user:tester` and `user:other-namespace/tester`, yield the same staff ID. Upstream
changes reach repositories through a deliberate `bun run refresh:oss`, followed
by update using that new pin; OSS never fetches upstream during init or update.

### `gitignore`

Build an ordered `.gitignore` from named sets (`visualstudiocode`, `linux`,
`macos`, `windows`, `node`, `turbo`), first-occurrence de-duplication. The
gitignore.io response is pinned to `vendor/gitignore` and refreshed deliberately
with `bun run refresh:gitignore`, so output is deterministic, reviewable, and
available offline. The pinned bytes carry a macOS rule that only matches with
literal CR characters, so the file is preserved `-text` in `.gitattributes`.

Under ticket 07's agreed policy:

- **init** builds `.gitignore` from selected sets with two owned blocks:
  - A topic block with `# Created by <URL>` / `# End of <URL>` markers recording the
    actual selected topics and a generated `# Edit at` URL for regeneration.
  - An additional-ignore block with `# Created by drop-calf additional ignores` /
    `# End of drop-calf additional ignores` markers, containing `.fallow/`, `.scratch/`,
    `.session/`, `/.cocoindex_code/` (no `vendor/`). URLs preserve the normalized,
    de-duplicated selection order; rule sections follow the pinned upstream order.
- **update** replaces complete owned blocks only, recovering topic selections from
  existing `# Created by https://...` markers in the file:
  - Inline owner edits outside marked blocks are preserved byte-exact.
  - The retired `yarn` topic is silently filtered from recovered selections; other
    unknown topics in the selection cause a precondition failure.
  - Missing files and missing blocks are left absent;
    an explicit init/copy seeds missing blocks without removing owner content.
  - Marked blocks with missing, mismatched, or nested/unmatched end markers fail
    before writing; legacy unclosed output is not adopted by guessing line ownership.
  - Markers use `https://www.toptal.com/developers/gitignore/api/<topics>`;
    complete legacy `gitignore.io/api/<topics>` blocks are also recognized.
  - The retired standalone Yarn section is absent from the refreshed pin, while
    Yarn-related rules shipped as part of upstream's Node section remain.
  - Unchanged owned content preserves original bytes; a second update changes nothing.
- **validate** is an explicit no-op: Git treats ineffective patterns as nonmatching,
  so checking which paths are ignored would enforce policy, not tool acceptance.

### `node`

The Node major is centralized in `src/versions.ts` (`24`). The capability owns
local Node selection, not the Forge manifest or a published package's
compatibility promise. No kind generates `engines`: it has caused trouble with
`forge deploy`,
which is why Forge apps use `.nvmrc` and `app.runtime.name` instead. Libraries and
tools may declare their own consumer compatibility after initialization; they
forgo an automatically generated npm install-time engine warning.

- **`.nvmrc`:** Init seeds `24` with a trailing newline. Update creates or
  replaces the whole file with the baseline.
- **`.npmrc`:** Init seeds the public npm registry and explanatory comment.
  Update creates or replaces the whole file.
- **`package.json.license`:** Init's update pass and every update pull
  `metadata.annotations["forge-ranch/license"]` from catalog. A missing catalog,
  malformed YAML, or missing/non-string/blank license fails for an existing package.
  Direct package license edits are replaced; unrelated fields are preserved.
  A missing package is not created and does not require catalog for Node's update.
  Matching values preserve original bytes; changes use sorted, two-space JSON with
  a trailing newline. OSS separately requires `Apache-2.0` for its pinned template.
- **`devDependencies["@types/node"]`:** Init seeds `24`, overriding the scaffold.
  Update preserves owner edits and absence; the dependency is init-only.
- **Forge `engines`:** Init removes the scaffold Node entry; its update pass
  removes the entire field. Update removes all entries, including owner additions.
- **Other kinds' `engines`:** Init removes scaffold `engines.node`, preserving
  other entries and dropping an empty object. Update preserves owner declarations.

Update owns **all** `.npmrc` content, not just `registry`. Scoped registries,
auth settings, comments, and other owner edits are replaced by the public-registry
baseline (`registry=https://registry.npmjs.org/`). No conflict or opt-in is
required for authoritative pins. Missing `.nvmrc` and `.npmrc` are created;
a missing `package.json` is not created. Node never reads or edits a manifest,
even in the Forge profile; runtime reconciliation belongs to `forge-manifest`.

Forge engine removal rejects malformed or non-object package JSON. Changes to
package JSON preserve unrelated fields and use sorted, two-space JSON with a trailing
newline when changing `license` or removing `engines`. Unchanged owned content retains
its bytes. A second update produces no changes. Neither init nor update creates a
manifest or registers an app.

**validate** checks only whether fnm accepts `.nvmrc`: copy that file alone into
an isolated Dagger container, initialize the shell with `fnm env --shell bash`,
and run `fnm use --install-if-missing`. The fnm version is pinned in
`TOOL_VERSIONS.fnm`; local file resolution is used and engine fallback is disabled.
Selectable non-baseline versions pass. Missing `.nvmrc` reports skipped with a
reason. Tool errors report failure with fnm's diagnostic; container setup or
network/download errors are execution failures, not proof of an invalid pin.
The validator may download Node on a cold run but never alters the caller's
repository or host shell, and no container changes are exported.

Validation does not compare `.nvmrc` and `@types/node` with one another or with
the baseline. Type declarations are owner-managed after init. It does not validate
`.npmrc` or run npm install. Forge manifest acceptance is handled separately by
the forge-manifest capability. This replaces the ticket's original pin-agreement
proposal with ADR 0001's tool-acceptance contract.

### `forge-manifest`

Forge-app-only capability that owns `manifest.yml`'s `app.runtime.name` key.

- **init** is an explicit no-op: `forge create` or the owner supplies the manifest.
  Drop Calf does not seed app identity or module wiring. Top-level init includes
  normal final update pass; there is no early scaffold-specific runtime mutation.
- **update** reads an existing `.nvmrc` and reconciles the runtime name in an existing
  manifest. Numeric pins with an optional `v` prefix and one to three components
  derive their major: `22`, `22.12`, and `v22.12.0` become `nodejs22.x`. Aliases,
  ranges, empty and malformed pins raise actionable `ParseError`; update does not
  resolve moving aliases or invent a major. Missing either file leaves the directory
  unchanged. Neither file is created here. Unsupported numeric majors are left for
  Forge's consuming tool to reject, rather than maintaining a parallel runtime schema.
  YAML edits preserve comments, existing key order, scalar styles,
  indentation, and sibling settings. Matching runtime values retain original bytes.
  A second update changes nothing. Malformed YAML and non-mapping parents
  fail before writing.
- **No key sorting** is enforced now; ordering remains owner-managed. It may be
  considered as a separate future update policy.
- **validate** runs `forge lint`, never `--fix`, with `TOOL_VERSIONS.forgeCli` (14.1.0)
  in an isolated Node-baseline container with Bun and analytics disabled. The supplied
  repository is mounted read-only; no container changes are exported. A missing
  manifest skips; lint and tool/setup failures report diagnostics. Full Forge lint
  includes source checks, not just manifest schema acceptance. Repository dependencies
  must already be available in the supplied tree; there is no repository dependency
  install, implicit host credential forwarding, registration, deployment,
  or installation.
  Manifest substitutions needing host values are not supplied;
  declared defaults work.
  Validation does not compare against `.nvmrc` or baseline policy and does not prove
  deployment readiness. `validate-forge-manifest` exposes the same standalone report.

**Authentication:** Forge CLI 14.1.0 requires authentication even for `forge lint`
and offers no offline flag. Standalone `validate-forge-manifest` and top-level
`validate` accept optional `forgeEmail` and `forgeApiToken` Dagger Secret arguments.
Both must be supplied to lint an existing manifest; otherwise validation reports
an execution prerequisite failure before allocating tools,
not an acceptance verdict.
The container injects them as `FORGE_EMAIL` and `FORGE_API_TOKEN` only after setup.
It never resolves or logs Secret values, reads host credentials implicitly,
logs in, or registers an app. Lint explicitly selects development without prompting.
Authenticated acceptance requires access to the registered app; no app identity is
rewritten. Bun execution produces Forge's unsupported-runtime warning, and full
authenticated CLI compatibility still requires verification.

`forge-manifest` runs immediately after Node in the Forge profile.
Node retains its
whole-file `.nvmrc` policy, so full-profile init/update still produces `nodejs24.x`;
standalone capability update derives the runtime from the supplied numeric pin.
Other kinds do not select this capability, even when a manifest is present.

### `changelog`

The release workflow owns `devDependencies["git-cliff"]` at
`TOOL_VERSIONS.gitCliff` and `scripts.changelog`:
`git cliff --config cliff.toml --unreleased -o CHANGELOG.md`. It is selected for
`library`, `forge-app`, and `tool`; `agent-skill` seeds neither the tool nor its files.

- **init** seeds the tool pin and command and overlays `templates/changelog` for
  `cliff.toml` and `CHANGELOG.md`. Init is fresh-repository setup, not a maintenance
  rerun.
- **update** enforces only the tool pin and canonical script in an existing
  `package.json`, creating missing sections and owned keys. A missing package is
  not created. Malformed/non-object JSON and non-object scripts/devDependencies
  fail before writes. Unrelated package values survive. Matching owned values
  preserve original bytes; changes use sorted, two-space JSON with a trailing
  newline. A second update changes nothing. No repository install or lockfile
  refresh runs.
- **`cliff.toml` and `CHANGELOG.md` are owner-managed after init.** Update never
  reads, rewrites, migrates, recreates, or regenerates either file. Owner edits
  and deletion survive. Commit groups, preprocessors (including the seeded Jira
  placeholder removal), and release templates are starting values, not enforced
  organization-wide policy. The explicit changelog command regenerates Markdown
  whole, never prepends; hand-written Markdown can be replaced by that command.
  Persistent generated prose belongs in the policy's `changelog.header`.
- **validate** retains the existing git-cliff acceptance check: render the canonical
  command using the capability-selected pin in an isolated Node container. It does
  not execute or compare `package.json` scripts, compare configuration with the seed,
  or check whether the stored Markdown is up to date. Owner configuration accepted
  by git-cliff passes without prior init/update. Missing `cliff.toml` or unavailable
  Git history reports skipped with a reason; command failure reports git-cliff's
  diagnostic. The render writes only in the throwaway container and no files are
  exported, so the caller's repository remains unchanged. Tool installation may
  require network access; setup/download failures are execution failures, not
  evidence of invalid configuration.

### `secrets`

Forge-only SecretSpec workflow. Owner declarations are separate from maintained
helper code. Secretspec and Gitleaks remain external prerequisites; the capability
never installs them or injects secret values.

- **init** overlays four assets from `templates/secretspec`: owner-managed
  `secretspec.toml` and `forge-variable-keys.json`, plus the two maintained helpers
  `scripts/env-var.sh` and `scripts/forge-vars-from-secretspec.js`. The TOML project
  name is substituted with string escaping; the helpers are seeded executable
  (`0755`). The JSON allowlist starts as `[]`. `FORGE_SITE` is required, with no
  assumed site. Init is first-time setup, not create-if-absent maintenance: an
  existing asset is replaced. The capability declares its seed step for TOML
  name substitution and explicit executable permissions; generic assembly
  executes the step without knowing either policy.
- **update** preserves both owner files byte-for-byte, including permissions,
  edits and deletions. It authoritatively replaces or restores both helpers with
  template bytes and `0755` permissions. It maintains only six package scripts:
  `forge:register`, `forge:deploy`, `forge:install`, `forge:uninstall`,
  `forge:upgrade` and `forge:variables:set`; unrelated scripts (including custom
  `forge:*` scripts), dependencies and package fields survive. No package is
  invented if `package.json` is absent. Non-interactive and scope-confirmation
  flags remain only on commands that support them (deploy, install and upgrade;
  confirmation is install/upgrade only).
- **migration safety**: before any tooling write, update statically inspects a
  legacy push helper. A nonempty, computed or mutated `APP_VARIABLE_KEYS` blocks
  update with instructions to move its keys into `forge-variable-keys.json` and
  remove the embedded declaration/references. Owner JavaScript is never run.
  An unmodified empty legacy list can be replaced. Update does not invent the
  owner JSON; an older repository must supply `[]` or its migrated keys before
  the new workflow is used.
- **validate** checks local structure, not baseline policy: TOML syntax (including
  duplicate keys), a nonempty project name, revision `1.0`, a default-profile
  table, declaration tables, optional description/default string types and
  boolean or named-group-array requirements. Profile defaults and other
  extension fields are not exhaustively schema-checked. The JSON must be an
  array of unique environment-variable names; `FORGE_*` CLI-targeting keys are
  not app variables. Every listed key must be declared locally in
  `profiles.default`; inherited declarations are not resolved. Both helper
  files must exist and have at least one execute bit (not necessarily `0755`).
  Missing TOML reports skipped; malformed/present incomplete workflows fail.
  No canonical-script/template comparison, secret resolution, helper execution,
  provider access or Forge mutation occurs. This is a local structural check,
  not proof of full SecretSpec CLI acceptance, installed prerequisites, or
  availability of values. Syntax diagnostics do not echo TOML source lines.

`env-var.sh` runs commands through `secretspec --file … run --provider dotenv
--reason … --profile … --`, so variables expand after injection and reads have
an audit reason. The push helper reads the JSON allowlist relative to its own
repository root and explicitly selects the default profile and root TOML.
An empty list does not invoke either external tool. Invalid or CLI-targeting
keys fail before secret access. Only selected values and `FORGE_ENVIRONMENT`
are captured from the injected environment; all selected values are checked
before any push. Each push is encrypted, and output/error handling never prints
values or child-process command details. Runtime secret delivery and CLI
prerequisite checks belong on the developer machine or CI, not in validation.

### `format`

The `biome` capability owns `@biomejs/biome` at `TOOL_VERSIONS.biome` and four
scripts: `format` (`biome format --write`), `format:check` (`biome format`),
`lint:check` (`biome lint`), and `lint:fix` (`biome lint --write`). It never owns
`lint`, hook dispatch, or unrelated package fields.

- **init** seeds the dependency and scripts, and overlays `templates/biome` for
  every kind. Its authored `biome.jsonc` schema matches the registry pin, enforced
  by a test. `.editorconfig` contains `[*]` defaults and a Markdown
  `trim_trailing_whitespace = false` override, preserving two-space hard line breaks.
- **update** enforces the dependency and four scripts in an existing `package.json`,
  creating missing sections and owned keys while preserving unrelated field values.
  Malformed/non-object JSON and non-object scripts/devDependencies fail before writes.
  Unchanged owned fields preserve package bytes; changes use sorted, two-space JSON
  with a trailing newline. Missing `package.json` is not created.
  Existing root `biome.json` (preferred) or `biome.jsonc` is migrated with the pinned
  tool's `biome migrate --write --config-path=<file>` in an isolated Node container.
  Only that root config is copied back; owner rules, exclusions, formatting settings,
  and comments follow Biome's migration rather than being reset to the template.
  Migration may reformat the config and rename/remove obsolete options. JSONC syntax
  and object-root checks are mutation preconditions because migration alone can accept
  malformed input. Missing configs remain absent. A removed `$schema` is not re-added
  when Biome considers migration unnecessary. Referenced and nested configs are not
  migrated or copied back. `.editorconfig` is init-only: owner edits and absence survive.
  Matching files retain their bytes; a second update changes nothing.
- **validate** loads the existing root config and its references with the capability's
  pinned Biome in a Node container, without requiring prior init or package installation.
  `biome check --config-path=<file> --formatter-enabled=false --linter-enabled=false
  --assist-enabled=false --no-errors-on-unmatched <file>` checks configuration acceptance
  without scanning project source or enforcing formatting/lint/assist results. It does
  not compare settings or schema with policy and does not invoke migration or autofix.
  Both root configs missing reports skipped with a reason; tool errors retain Biome's
  diagnostic. Missing/invalid referenced configs or required ignore files can fail
  loading. Setup/download errors are execution failures, not evidence of invalid config.
  The repository is mounted read-only and no container changes are exported.
  EditorConfig has no separate validator in this capability.

Neither operation invokes a host Biome binary or creates host temporary directories.
Tool installation may require network access on a cold container run. Update does not
install repository dependencies or refresh package-manager lockfiles; those remain the
owner's package-manager workflow.

### `docs`

Every kind includes the documentation workflow: `devDependencies.cspell` at
`TOOL_VERSIONS.cspell`, `devDependencies["markdownlint-cli2"]` at
`TOOL_VERSIONS.markdownlintCli2`, and `scripts["lint:docs"]`:
`markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"`.

- **init** seeds both tool pins and the command and overlays `templates/docs`.
  The tree includes the four Diátaxis placeholders, `DEVELOPMENT.md`, `specs/spec.md`,
  `.markdownlint-cli2.jsonc`, and `.cspell.jsonc`. These are starting content, not
  continuing policy.
- **update** enforces only the two tool pins and canonical script in an existing
  `package.json`, creating missing sections and owned keys. Missing package stays
  absent; malformed/non-object JSON and non-object scripts/devDependencies fail
  before writes. Unrelated fields survive. Matching values preserve package bytes;
  changes use sorted, two-space JSON with a trailing newline. A second update
  changes nothing. No repository install or lockfile refresh runs.
- **Documentation and both configs are owner-managed after init.** Update never
  reads, recreates, rewrites, or migrates them. Authored prose, added spelling words,
  custom rules, exclusions, comments, and intentional deletions survive byte-for-byte.
  Neither config is split: the seeded markdownlint rules and CSpell settings are
  defaults, not centrally enforced policy, so there is no maintained rules file.
- **validate** loads the two seeded root configs with the capability-selected tools
  in an isolated Node-baseline container using the centralized Bun runtime pin.
  Both configs missing reports skipped; a partial pair reports failed. No prior
  init, update, package installation, or baseline agreement is required.
  Markdownlint runs with `--config .markdownlint-cli2.jsonc --no-globs "**/*.md" "#**"`;
  CSpell runs with `lint --config .cspell.jsonc --no-config-search
  --no-must-find-files --no-progress --exclude "**" "**/*.md"`. Both load config while
  selecting zero documents, even with owner globs and markdownlint autofix enabled.
  Malformed JSONC and unavailable config imports/extends fail with tool diagnostics;
  accepted owner configurations pass. The repository is mounted read-only and
  no container changes are exported. Tool setup/download failures are execution
  failures, not evidence of invalid config.

This validates loading of the two root JSONC files and their config references,
not every alternative config discovery format, nested configuration, full schema,
rule parameters, dictionary availability, or documentation spelling/style. Some
invalid option types can be accepted by a no-file load; validation follows tool
acceptance, not a stricter invented schema. Config modules referenced by imports
or extends can execute; owner dependencies must be available in the supplied tree.
Content linting belongs to `lint:docs`, not this validator.

### `forge-prelint`

The `prelint` capability is selected only for `forge-app`. It owns
`devDependencies["@ast-grep/cli"]` at `TOOL_VERSIONS.astGrep` and
`devDependencies["@forge-ahead/prelint"]` at `TOOL_VERSIONS.forgePrelint`
(`github:ibuchanan/tool-forge-prelint-ast-grep` by default), plus two scripts:

- `lint:prelint`: `ast-grep scan --globs '!specs/**' --globs '!node_modules/**' --config ./node_modules/@forge-ahead/prelint/sgconfig.ecosol.yml`
- `lint:forge`: `forge lint`

Under ticket 16's agreed policy:

- **init** is an explicit no-op: "Prelint has no repository-local configuration to
  seed; its rules ship in the dependency package, and update maintains the tool
  dependencies and scripts." Top-level init's final update pass adds the dependencies
  and scripts after scaffold merging; there is no local rule/config template.
- **update** enforces both capability-selected dependency references and both canonical
  scripts in an existing `package.json`, replacing owner edits and creating missing
  sections/owned keys. The scan exclusions and packaged config path are enforced as
  part of the whole script, not merged with owner arguments. A missing package stays
  absent. Malformed/non-object JSON and non-object scripts/devDependencies fail before
  writes. Unrelated package values, local config, hook config, source, and lockfiles
  survive. Matching owned values retain original bytes; changes use sorted, two-space
  JSON with a trailing newline. A second update changes nothing. No dependency install,
  source scan, or lockfile refresh runs.
- **validate** is an explicit no-op: "Prelint has no repository-local configuration to
  validate; its rules ship in the dependency package. Source scanning belongs to the
  lint workflow." Both capability validation and standalone `validate-prelint` return
  skipped with that reason, without reading the repository, installing tools, scanning
  source, or running `forge lint`. This supersedes the previous container scan validator;
  Forge acceptance belongs to the separate `forge-manifest` validator.

Prelint never writes `lint` or `lefthook.yml`. Git-hooks alone owns `lint`, and its
seeded config dispatches both named subtasks with `--if-present`; owner hook edits
remain owner-managed.

### `library-build`

The `library` composition uses the `forge-ahead-errors` pipeline: tsdown bundles
ESM and CJS, TypeScript emits declarations, and the build script copies every
`.d.ts` to its corresponding `.d.cts`, including nested outputs.

| Resource | Init | Update |
|---|---|---|
| `devDependencies.tsdown` | Seed `TOOL_VERSIONS.tsdown` (`^0.23`) | Enforce selected range |
| `scripts.build` | Seed `sh scripts/build.sh` | Enforce command |
| `scripts/build.sh` | Overlay reviewed template | Enforce whole template |
| `tsdown.config.json` | Overlay reviewed template | Enforce `format: ["esm", "cjs"]`; preserve all other settings |
| `main`, `types`, `exports`, `files` | Seed publishing defaults | Preserve owner values and deletions |

The JSON seed contains `entry: {"index": "./src/index.ts"}`, both formats,
`sourcemap: true`, and `target: "node22"`. Publishing defaults are
`main: "dist/index.mjs"`, `types: "dist/index.d.ts"`, and `files: ["dist"]`.
The `.` export has `import` with `types: "./dist/index.d.ts"` and
`default: "./dist/index.mjs"`, and `require` with `types: "./dist/index.d.cts"`
and `default: "./dist/index.cjs"`. Additional entries, dependency externals,
subpath exports and publishing paths are library-specific owner settings.

Update does not create a missing package. An existing package with missing owned
sections or keys is repaired. Missing config or script is restored. Executable
`tsdown.config.{ts,mts,cts,js,mjs,cjs}` or `package.json#tsdown` conflicts fail with
instructions to move owner settings to JSON; update never silently shadows them.
Malformed shared metadata, non-object sections, or malformed/non-object bundler
JSON fails before a result is returned. Matching package and config bytes are
retained; a second update changes nothing. No build, dependency installation,
lockfile change, artifact inspection, or publishing-field reconciliation occurs.

Library-build precedes TypeScript in composition so adding its dependency selects
Bundler compiler policy in the same pass. TypeScript alone owns the declaration
compiler config; library-build never edits tsconfigs. The enforced script runs
`tsdown --no-dts`, `tsc -p tsconfig.declarations.json`, then copies declarations.
The script uses the example's fixed `dist` output directory.

**Validate** is an explicit no-op: tsdown 0.23 exposes no supported
configuration-only loader. Its exported `resolveUserConfig` is documented as
internal, and `--no-write` still bundles source. Validation does not execute a
build or assess stale artifacts; build execution belongs to the build workflow.
The separate TypeScript validator checks acceptance of declaration compiler config.

### `typescript`

TypeScript owns `devDependencies.typescript`, `scripts.typecheck`, both root tsconfigs,
and `scripts.build` except in the library composition, where library-build alone owns it.
`@types/node` belongs to Node. The compiler range comes from `TOOL_VERSIONS.typescript`;
there is no `dev` script.

- **init** seeds the compiler and owned scripts and overlays `templates/typescript`.
  The final update pass sees all declared dependencies, including Vitest and tsdown,
  before applying the conditional compiler policy. Vitest does not seed a tsconfig.
- **update** enforces the compiler range and typecheck script in an existing package.
  It enforces `build: tsc --project tsconfig.json` only when this capability owns build
  and `devDependencies` does not declare `tsdown`. Library build commands and unrelated
  package fields survive. Missing package sections/owned keys are created; a missing
  package is not. Changes use sorted two-space JSON with a trailing newline, while
  unchanged package bytes are retained. No repository install or lockfile update runs.
  Both baseline configs are recreated from their TypeScript seeds if missing;
  existing JSONC receives targeted edits preserving unrelated settings and comments.
  When `tsdown` is declared, TypeScript also seeds and reconciles
  `tsconfig.declarations.json`: `extends: ./tsconfig.json`, `include: ["src"]`,
  `declaration: true`, `emitDeclarationOnly: true`, `rootDir: ./src`, `outDir: ./dist`,
  and `ESNext`/`Bundler`. It is not seeded for other projects; an existing declaration
  config is retained if the trigger is removed.

Compiler policy uses declarations in `devDependencies`, not installed modules, dependency
versions, runtime dependencies, or profile names. Presence of the key selects the policy.
The owning dependency capabilities maintain those declarations. Removing a trigger resets
its owned compiler options and file-selection lists to baseline on the next update.
When those capabilities gain dependency-update policies, their update must precede
TypeScript's config reconciliation in the same composed pass; needing a second pass
to observe newly created tool declarations would violate top-level idempotence.

| Setting | Baseline | `vitest` declared | `tsdown` declared |
|---|---|---|---|
| Base `module` / `moduleResolution` | `CommonJS` / `Node` | unchanged | `ESNext` / `Bundler` |
| Typecheck `module` / `moduleResolution` | `CommonJS` / `Node` | `ESNext` / `Bundler` | `ESNext` / `Bundler` |
| Typecheck `rootDir` | `src` | `.` | `.` |
| Typecheck `include` | `["src"]` | add `test`, `tests`, `vitest.config.ts` | unchanged (bundler config is JSON) |

Both triggers combine; tsdown selects the base module settings, and Vitest adds its
typecheck inputs. Base `include` is always `["src"]`. Typecheck always extends
`./tsconfig.json` and excludes `node_modules`, `dist`, `coverage`, and `specs`.
These lists are owned whole-array values, not additive merges of owner paths.

All compiler options explicitly present in each seed are enforced on update. Base options
are `jsx: react-jsx`, `sourceMap: true`, `target: ES2022`, `lib: ["ES2022"]`,
`strict: true`, `esModuleInterop: true`, `skipLibCheck: true`,
`forceConsistentCasingInFileNames: true`, `outDir: dist`, `rootDir: src`, and the module
pair above. The Node baseline is 24; ES2022 is a conservative target, not a minimum
consumer runtime promise. Typecheck enforces `noEmit`, `noImplicitReturns`,
`noUncheckedIndexedAccess`, `noUncheckedSideEffectImports`, `noImplicitOverride`,
`noPropertyAccessFromIndexSignature`, and `exactOptionalPropertyTypes` as true, plus
its conditional module pair and rootDir. Other options such as `paths`, `types`,
`declaration`, and project references survive. `isolatedDeclarations` is not enforced;
it is an optional tsdown optimization. Malformed JSONC, duplicate keys, non-object roots
or compilerOptions, and malformed package scripts/devDependencies fail before a result
is returned. Matching config bytes remain unchanged; a second update changes nothing.

- **validate** runs the capability-selected compiler's `tsc --showConfig --project <file>`
  for both baseline configs and any existing declaration config in a Node-baseline
  container with a read-only repository mount.
  It does not compile source, emit files, compare settings with policy, or validate Forge
  deployment/tsdown output. Owner settings accepted by TypeScript pass. Both configs
  missing reports skipped; a partial pair reports failed. Invalid settings, missing
  extended configs, and no matched input files report failure with the tool's diagnostic
  (including stdout). `--showConfig` can recover from syntax errors (for example an
  unterminated `{`) without failing; validation follows that acceptance and is not a
  strict JSONC syntax audit. Mutation rejects malformed syntax independently.
  A configuration-only starter with no inputs does not
  pass `--showConfig`. Package-based extends must already be available in the supplied
  repository; validation does not install its dependencies. The compiler may be downloaded
  on a cold run; setup/network errors are execution failures, not proof of invalid config.
  No container changes are exported.

### `forge-ahead`

The Forge app capability contributes runtime dependencies in `package.json` with
separate lifecycles:

| Dependency | Init | Update |
|---|---|---|
| `@forge-ahead/atlassian-api-types` | Seed `TOOL_VERSIONS.forgeAheadApiTypes` | Preserve owner value or deletion |
| `@forge-ahead/errors` | Added by top-level init's update pass | Enforce `TOOL_VERSIONS.forgeAheadErrors` |
| `@forge-ahead/logging` | Added by top-level init's update pass | Enforce `TOOL_VERSIONS.forgeAheadLogging` |

- **init** seeds only API types as a convenience for a new app. Not every app calls
  product APIs; after initialization the owner may replace or remove this dependency.
  Seeding merges this one key into blueprint dependencies rather than replacing the
  object, so unrelated contributions survive without relying on scaffold merging.
- **update** owns only the errors and logging keys in `dependencies`. It replaces
  owner-selected references, including newer versions or alternate Git references,
  with the registry references; no version comparison or conflict detection runs.
  API types is not added, removed, or rewritten. Missing owned keys or a missing
  dependencies section are created; a missing `package.json` stays absent.
  Malformed/non-object JSON or a non-object dependencies section fails before writes.
  Other dependencies, package fields, source, and lockfiles survive. Matching owned
  values retain package bytes; changes use sorted, two-space JSON with a trailing
  newline. A second update changes nothing. No dependency install or lockfile refresh
  runs.
- **validate** is an explicit no-op: "Forge Ahead dependencies have no repository-local
  configuration to validate; comparing dependency references would check policy, not
  tool acceptance. Runtime integration belongs to the app's build and test workflows."
  It reports skipped without reading the repository or installing dependencies.

Repository URLs are supported dependency specs. The current registry values are
GitHub references without a commit or tag; update enforces the reference strings,
not immutable resolved versions.

### `aidev`

Agent guidance is a capability in every kind's ordered composition. Only
`forge-app` seeds the current authored `AGENTS.md`; other kinds omit Forge-only
instructions with an explicit init no-op reason. The seed content is unchanged;
expanding it is a separate concern.

- **init** seeds the Forge guidance during first-time setup, replacing any Forge
  scaffolder guidance removed by scaffold preparation. It is enabled by default
  on `forge-app`; `--without aidev` excludes the capability from all three passes.
  Explicit `--with aidev` and excluding it on non-Forge kinds remain invalid.
  Non-Forge init is a no-op: "Only Forge apps have an authored agent guidance
  seed; other project kinds omit Forge-specific instructions."
- **update** is a no-op: "Agent guidance is init-only and owner-managed; update
  preserves edits and does not restore a deleted AGENTS.md." No marked block is
  maintained, and update does not create a missing guidance file.
- **validate** is a no-op: "AGENTS.md is human guidance, not consuming-tool
  configuration; checking referenced scripts would check guidance policy, not
  tool acceptance." It does not parse guidance or compare named scripts with
  `package.json`. Top-level validation reports a skipped result with this reason
  whenever the capability is selected.

Aidev owns only `AGENTS.md`; it contributes no package fields, scripts,
dependencies, or template trees. Profile assembly invokes its verbs like any
other capability rather than writing guidance separately.

### `test`
The testing slot selects Bun's built-in runner for `library`, `tool`, and
`agent-skill`, and Vitest for `forge-app`. Agent skills can ship executable scripts;
there is no no-testing implementation or testing opt-out.

#### Bun verbs (`library`, `tool`, `agent-skill`)

- Bun owns `test`, `test:watch`, and `test:coverage` with
  `bun test --pass-with-no-tests`, `bun test --watch --pass-with-no-tests`, and
  `bun test --coverage --pass-with-no-tests`. It needs no test-runner dependency
  or config.
- **init** is an explicit no-op: "Bun's built-in test runner needs no dependency or
  configuration seed; update maintains the test scripts, and test sources are
  owner-managed." Top-level init includes the update pass.
- **update** enforces only the three script keys above. A missing `package.json`
  is left absent; missing scripts and owned keys are created. Malformed/non-object
  JSON or non-object scripts fail before writes. Other scripts, fields, and
  dependencies survive. Matching owned values preserve package bytes; changes use
  sorted, two-space JSON with a trailing newline. A second update changes nothing.
  Update never reads or changes `bunfig.toml`, test sources, or lockfiles, and does
  not install dependencies or pin the host Bun runtime.
- **validate** is an explicit no-op: "This capability owns no Bun test configuration
  to validate. Test execution belongs to the test workflow; comparing scripts to
  defaults would check policy, not tool acceptance."

Vitest owns the same scripts with `vitest run --passWithNoTests`,
`vitest watch --passWithNoTests`, and `vitest run --coverage --passWithNoTests`.
`vitest` and `@vitest/coverage-v8` are devDependencies at the same exact version
(`5.0.3`), both supplied by `TOOL_VERSIONS.vitest` so coverage never prompts to
install a provider.

#### Vitest verbs (`forge-app`)

- **init** declares `templates/vitest`, seeding `vitest.config.ts`, the three scripts,
  and both development dependency pins. The seed excludes `node_modules`, `dist`,
  `coverage`, and `specs/**`, disables globals in favor of explicit imports, and selects
  V8 coverage. All config settings are starting values, not continuing policy.
- **update** enforces the three scripts and bumps `vitest` and `@vitest/coverage-v8`
  together to `TOOL_VERSIONS.vitest` in an existing package. Missing sections and owned
  keys are created; a missing package is not. Malformed/non-object JSON or non-object
  scripts/devDependencies fail before writes. Other package values survive. Matching
  owned values preserve package bytes; changes use sorted, two-space JSON with a trailing
  newline. A second update changes nothing. Update never reads, rewrites, migrates, or
  recreates `vitest.config.ts`; owner edits and deletion survive. It does not install
  repository dependencies or refresh lockfiles.
- **validate** loads `vitest.config.ts` using the capability-selected Vitest pin and
  discovers test files with `globTestSpecifications()` (the file-only listing API).
  An empty suite passes. Test modules, assertions, setup files, and global setup are not
  executed. Configuration and its plugins/providers are executable and are evaluated.
  The selected coverage provider is loaded, initialized, and its options resolved, without
  coverage collection, cleanup, reports, or threshold checks. Built-in V8 and Istanbul
  providers must expose the same version as the runner; custom providers must load and
  initialize but have no Vitest-version equality requirement. Owner choices of globals,
  exclusions, and provider are not compared to the seed. Missing config reports skipped;
  failed loading/discovery or provider compatibility reports failure with diagnostics.

Validation installs the pinned runner and V8 provider only in an isolated Dagger tool
container, using the centralized Bun runtime pin on the Node-baseline image. The supplied
repository is mounted read-only, with the selected runner overlaid separately; installed
owner dependencies remain available and isolated tool dependencies provide a fallback.
Owner-installed coverage providers take precedence over the fallback, so mismatched
versions fail instead of being hidden by the bundled V8 pin. Istanbul, custom providers,
plugins, and other config dependencies must be available in the supplied tree. The Vite
runner config loader avoids bundled temporary config files. No container changes are
exported. Setup/download failures are execution failures, not invalid-config evidence.

Vitest never writes either tsconfig. Declaring `vitest` in devDependencies triggers
TypeScript's typecheck policy: include source, test trees, and `vitest.config.ts`, exclude
specs/output trees, and use modern module resolution. Vitest alone does not change the
base Forge compiler settings. In the Forge composition, Vitest precedes TypeScript so
new dependency declarations affect config policy in the same update pass.

Both runners accept a scaffold with no tests. Test sources remain user-owned;
Forge architecture-test seeds are a separate, optional concern.

### `clean-build`

Every project kind selects this capability. It owns only `package.json#scripts.clean`
with the canonical command `rm -rf dist`. Generated projects assume a POSIX-compatible
shell and `rm`; native Windows shell support is outside this policy. No dependency,
configuration file, or additional cleanup target is introduced.

- **init** is an explicit no-op: "Clean build has no files, dependencies, or initial
  settings to seed; update maintains the clean script." Top-level init's update pass
  supplies the command.
- **update** enforces the canonical command in an existing package, replacing owner
  edits to `scripts.clean` and creating a missing scripts section or clean key. A
  missing `package.json` is not created. Malformed/non-object JSON and a non-object
  scripts section fail before writes. Other package fields, script keys, files,
  dependencies, and lockfiles survive. Matching values preserve original package
  bytes; changes use sorted, two-space JSON with a trailing newline. A second update
  changes nothing.
- **validate** is an explicit no-op: "Clean build owns no configuration with a separate
  tool-acceptance check; executing the clean script would delete build output and
  belongs to the clean workflow." It reports skipped without reading the repository,
  comparing the script to policy, or executing any command.

Drop Calf never executes the clean script during init, update, or validate, and never
removes build output through this capability. The command removes only `dist` relative
to the package root when the owner explicitly runs the clean workflow.

### `evals` (optional; `--preset all` or `--with evals`)

Selection is explicit for all three verbs. Only `forge-app` supports this optional
capability. Repository files, scripts, and dependency declarations do not select it;
without selection, update does not modify evals tooling and validate does not report
an evals result. `--without evals` excludes it from the all preset.

| Resource | Init | Update |
|---|---|---|
| `devDependencies.promptfoo` | Seed `TOOL_VERSIONS.promptfoo` | Enforce the registry reference |
| `scripts.eval`, `scripts.view` | Seed `promptfoo eval`, `promptfoo view` | Enforce the canonical commands |
| `promptfooconfig.yaml`, prompts, tests, data, guide | Overlay `templates/promptfoo` | Preserve owner edits and deletions |
| `manifest.yml` agent wiring | Owner-managed | No changes |

- **init** seeds the dependency and scripts and overlays the authored template tree.
  Initialization is first-time setup, not a safe rerun over an owner-authored suite;
  use update for maintenance. All seeded suite content is init-only, including the
  Promptfoo config's provider, prompts, and test references. No suite setting is
  enforced on update.
- **update** enforces only `scripts.eval`, `scripts.view`, and
  `devDependencies.promptfoo` in an existing `package.json`, even if no config or
  suite exists. Missing owned keys or sections are created; a missing package is
  not created. Malformed/non-object JSON and non-object consumed sections fail
  before writes. Other package fields, script keys, dependencies, files, and
  lockfiles survive. Matching values retain package bytes; changes use sorted,
  two-space JSON with a trailing newline. A second update changes nothing. No
  dependency install, lockfile refresh, config repair, or seed restoration runs.
- **validate** reports skipped when root `promptfooconfig.yaml` is missing, before
  installing tools. Otherwise it installs the capability-selected Promptfoo reference
  in an isolated Node-baseline container and uses Bun to invoke Promptfoo's native
  `doValidate` handler from `dist/src/commands/validate.js`. This is the handler used
  by `promptfoo validate --config`; it loads referenced prompts, tests, and providers
  and checks the native config and test-suite schemas. An unmatched test-file glob
  is accepted as an empty suite by Promptfoo 0.116.7; validation does not add stricter
  reference-existence checks. Unknown assertion type names also pass native config
  validation; runnable assertion semantics belong to evaluation. Owner config
  accepted by the tool passes regardless of package pins, scripts, or template
  defaults. Native failures report diagnostics through the top-level failed result.
  The repository is mounted read-only, Promptfoo state and logs are outside it, and nothing is
  exported. The CLI startup database migrations and command telemetry are bypassed;
  update checks and telemetry are disabled. The handler's env path is `/dev/null`
  so repository `.env` files are not loaded. No eval or view command runs, no model
  credentials are forwarded, and the native validation handler does not call models
  or execute assertions. Owner-authored loaders and custom provider constructors
  may execute while the tool resolves configuration; validation is not a sandbox
  for arbitrary owner code.

The current registry reference is `^0.116.0`, a version range rather than an exact
pin. Validation uses the same capability-selected reference, not the version in the
owner's package or lockfile. The internal handler is version-sensitive and is covered
by an opt-in live acceptance test.

Manifest wiring is deliberately manual: Drop Calf does not edit `manifest.yml`
for `evals`, because agent selection and behavior belong to the app owner.
`prompts/agent-instructions.md` is the shared prompt source. Seed
`docs/how-to/evaluate-rovo-agent.md` with a `rovo:agent` prompt-resource example
that resolves to that file, already read by the Promptfoo test cases. The translation
example runs without an agent. Evaluation is a prompt simulation through the
configured provider, not a test of the deployed Rovo runtime.

### `size`

The `size-limit` capability is selected for `library` and `forge-app`. It owns
`devDependencies["size-limit"]`, `devDependencies["@size-limit/file"]`, and
`scripts.size` (`npm run build && size-limit`). Both tools use the same exact
`TOOL_VERSIONS.sizeLimit` pin (`11.2.0`); the file adapter declares an exact peer
version, so separate pins or independently resolving ranges can be incompatible.

- **init** seeds both tool pins, the command, and one `package.json["size-limit"]`
  budget with a `10 kB` limit: `Library bundle` at `dist/index.mjs` for libraries,
  or `Forge app bundle` at `dist/**/*.js` for Forge apps. It replaces scaffold
  budgets during fresh initialization and declares no template tree.
- **update** enforces only the paired pins and canonical command in an existing
  package, creating missing sections and owned keys. A missing `package.json`
  is not created. Malformed/non-object JSON and non-object scripts/devDependencies
  fail before writes. Other package fields, files, and lockfiles survive. Matching
  owned values preserve original bytes; changes use sorted, two-space JSON with
  a trailing newline. A second update changes nothing. No install, lockfile
  refresh, build, or measurement runs.
- **The entire budget is owner-managed after init.** Update does not validate,
  merge, reset, restore, or migrate its names, paths, limits, additional entries,
  or options. Deletion and even malformed budget values survive update. External
  Size Limit configuration files are also untouched. This supersedes the previous
  same-name conflict rule: a tuned budget is not a conflict.
- **validate** is an explicit no-op: "Size Limit has no supported configuration-only
  validation interface. Measurement requires build artifacts and belongs to the
  size workflow; validation does not build the project or assess potentially
  stale output." It reports skipped without reading the repository, installing
  tools, resolving paths, or measuring output. It does not establish configuration
  acceptance, build success, or budget compliance.

The published Size Limit 11.2.0 CLI always calculates sizes after loading config;
its public API also calculates sizes, and its config checker is private. Path
comparison with the seed would be policy compliance, not tool acceptance. The
explicit size workflow builds before measuring and lets Size Limit diagnose the
owner's configuration and artifacts. Forge's seeded glob measures TypeScript's
local `dist/` output, not the Forge deployment bundle.

### `git-hooks`

Git-hooks alone owns `devDependencies.lefthook` at `TOOL_VERSIONS.lefthook` and
three scripts: `prepare` (`lefthook install || true`), `lint` (`lefthook run lint`),
and `check` (`lefthook run pre-push --force`). Prelint contributes `lint:prelint`
and `lint:forge` without writing `lint`; ownership does not depend on pass order.

- **init** seeds the pin, scripts, and authored `templates/git-hooks/lefthook.yml`
  for every kind. The shared seed groups prelint, Biome, Forge, typecheck, and
  formatting under `lint`; pre-commit runs gitleaks and formatting; pre-push runs
  lint, tests, and size checks. npm script calls use `--if-present` so omitted
  subtasks are no-ops. Init is fresh-repository setup, not maintenance adoption.
- **update** enforces only the runner pin and three canonical scripts in an
  existing package, replacing owner edits and creating missing sections/keys.
  Missing `package.json` is not created. Malformed/non-object JSON and non-object
  scripts/devDependencies fail before writes. Unrelated values and lockfiles survive.
  Matching values preserve original bytes; changes use sorted, two-space JSON with
  a trailing newline. A second update changes nothing. No dependency install,
  hook installation, or lockfile refresh runs.
- **`lefthook.yml` is owner-managed after init.** Update never reads, rewrites,
  merges, migrates, or recreates it; edits and deletion survive. The gitleaks guard
  and pre-push checks are starting defaults, not continuing enforced policy.
- **validate** runs the capability-selected Lefthook's `lefthook validate` in an
  isolated Node-baseline container. Lefthook checks its resolved configuration
  against its bundled JSON schema, including supported extends/local overrides.
  No hook commands or package scripts are executed; validation neither compares
  config/scripts with the baseline nor audits npm script references. An owner
  config that Lefthook accepts passes without prior init/update. Missing root
  `lefthook.yml` reports skipped with a reason; failures retain tool diagnostics.
  Lefthook tolerates missing relative extends files; validation follows that
  acceptance rather than adding a stricter reference-existence check.

Lefthook requires Git metadata for configuration loading. Validation initializes
throwaway Git metadata outside the read-only repository mount and uses it instead
of the caller's `.git`, including worktree pointers and installed hooks. No Git
history is required. Tool installation and configured remote loading may require
network access; any remote cache writes stay in the isolated container. Neither
source files nor hooks are installed/modified in the caller's repository, and no
container changes are exported. Setup/download errors are execution failures, not
evidence of invalid configuration.

Ticket 15 supersedes the older managed-baseline/additive-adoption split: update
always owns the package pin/scripts, including existing `lint`/`check`, and never
adopts or merges existing hook configuration.

## 5. Composition into project kinds

Which functions each project kind selects is specified in
[`01-project-kinds.md`](01-project-kinds.md). The functions themselves are composition
targets only: a kind assembles functions, but the stable script interface above belongs to
the owning functions, never to the kind.

## 6. Error and conflict classes

Failures name the function, affected path, discovered value, wanted value, and a suggested
remedy: `InvalidOptionsError`, `PrerequisiteError`, `ConflictError`, `ParseError`
(no partial mutation on unparseable input), `ValidationError`.
