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
catalog → package-metadata → oss → gitignore → node → changelog → secrets → format → forge-prelint
→ typescript → forge-ahead → aidev → test → evals (optional) → size → git-hooks
```

**Note:** Init sequence stages catalog init before OSS; within the init pass, capabilities run in listed order. The OSS capability depends on catalog being initialized first to read metadata.
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
not match. Standalone `copy-catalog` and `validate-catalog` functions do not require
`package.json`; `copy-catalog` accepts a component type independently of the currently
supported project kinds. Standalone `copy-oss` takes a directory only and requires the
catalog to be present and valid.

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
argument is retained during expansion but ignored: author, OWNER, and catalog owner
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
`user:tester` and `user:other-namespace/tester`, yield the same staff ID. Standalone
`copy-oss` takes only a directory containing catalog and deliberately re-seeds all
six files, including README; it is not the maintenance update operation. Upstream
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
local selection and the Forge runtime, not a published package's compatibility
promise. No kind generates `engines`: it has caused trouble with `forge deploy`,
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
- **Forge `app.runtime.name`:** Init and update set `nodejs24.x` in an existing
  manifest, replacing mismatches to agree with the `.nvmrc` baseline.
- **Forge `engines`:** Init removes the scaffold Node entry; its update pass
  removes the entire field. Update removes all entries, including owner additions.
- **Other kinds' `engines`:** Init removes scaffold `engines.node`, preserving
  other entries and dropping an empty object. Update preserves owner declarations.

Update owns **all** `.npmrc` content, not just `registry`. Scoped registries,
auth settings, comments, and other owner edits are replaced by the public-registry
baseline (`registry=https://registry.npmjs.org/`). No conflict or opt-in is
required for authoritative pins. Missing `.nvmrc` and `.npmrc` are created;
missing `package.json` and `manifest.yml` are not. Other kinds never read or edit
a manifest, even if one is present.

Forge runtime edits use the YAML document API to preserve comments, key order,
scalar styles, indentation, and siblings such as `memoryMB`, `architecture`, and
`id`. Matching runtime values preserve the original bytes. Malformed YAML or
non-mapping parents raise `ParseError`; Forge engine removal also rejects malformed
or non-object package JSON. Changes to package JSON preserve unrelated fields and
use sorted, two-space JSON with a trailing newline when changing `license` or removing `engines`.
Unchanged owned content retains its bytes. A second update produces no changes.
Neither init nor update creates a manifest or registers an app.

**validate** checks only whether fnm accepts `.nvmrc`: copy that file alone into
an isolated Dagger container, initialize the shell with `fnm env --shell bash`,
and run `fnm use --install-if-missing`. The fnm version is pinned in
`TOOL_VERSIONS.fnm`; local file resolution is used and engine fallback is disabled.
Selectable non-baseline versions pass. Missing `.nvmrc` reports skipped with a
reason. Tool errors report failure with fnm's diagnostic; container setup or
network/download errors are execution failures, not proof of an invalid pin.
The validator may download Node on a cold run but never alters the caller's
repository or host shell, and no container changes are exported.

Validation does not compare `.nvmrc`, `@types/node`, or `app.runtime.name` with
one another or with the baseline. Type declarations are owner-managed after init.
It does not validate `.npmrc`, run npm install, or establish Forge manifest or
deployment acceptance; Forge manifest acceptance belongs to ticket 23. This
replaces the ticket's original pin-agreement proposal with ADR 0001's tool-acceptance
contract.

### `changelog`

The release workflow owns `devDependencies["git-cliff"]` at
`TOOL_VERSIONS.gitCliff` and `scripts.changelog`:
`git cliff --config cliff.toml --unreleased -o CHANGELOG.md`. It is selected for
`library`, `forge-app`, and `tool`; `agent-skill` seeds neither the tool nor its files.

- **init** seeds the tool pin and command and overlays `templates/changelog` for
  `cliff.toml` and `CHANGELOG.md`. Init is fresh-repository setup, not a maintenance
  rerun. Standalone `copy-changelog` deliberately overlays both files without
  changing package metadata; it is not update.
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
Seed `secretspec.toml`, `scripts/env-var.sh` and
`scripts/forge-vars-from-secretspec.js` from `templates/secretspec` (authored content,
never rebuilt by the capability), substituting only the project name. `FORGE_SITE` is
`required` — no site is assumed — and the TOML documents the split between CLI-targeting
`FORGE_*` values and app-level runtime secrets.

`env-var.sh` runs any command through `secretspec --file … run --provider dotenv --reason
… --profile … --` so `$FORGE_*` expand only after injection and every read is recorded;
the `forge:*` scripts wrap `forge` through it. The app-variable helper pushes only the
keys in its `APP_VARIABLE_KEYS` allowlist, always `--encrypt`, and never prints values;
the seeded list is empty. Seeding is create-if-absent for `forge-app` only, so
an edited config or helper is left alone. The secrets policy slice assigns the
tree's lifecycle to the required verbs. Secretspec and Gitleaks are external
prerequisites; never installed, never injected. A prerequisite check is deferred: it
must run where the tools are used (the developer's machine or CI), not inside the
module's runtime container, which never has them.

### `format`

The `biome` capability owns `@biomejs/biome` at `TOOL_VERSIONS.biome` and four
scripts: `format` (`biome format --write`), `format:check` (`biome format`),
`lint:check` (`biome lint`), and `lint:fix` (`biome lint --write`). It never owns
`lint`, hook dispatch, or unrelated package fields.

- **init** seeds the dependency and scripts, and overlays `templates/biome` for
  every kind. Its authored `biome.jsonc` schema matches the registry pin, enforced
  by a test. `.editorconfig` contains `[*]` defaults and a Markdown
  `trim_trailing_whitespace = false` override, preserving two-space hard line breaks.
  Standalone `copy-biome` deliberately seeds the same template bytes; it is not update.
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
  Forge manifest acceptance remains separately tracked in ticket 23.

Prelint never writes `lint` or `lefthook.yml`. Git-hooks alone owns `lint`, and its
seeded config dispatches both named subtasks with `--if-present`; owner hook edits
remain owner-managed. The legacy `addTo` contribution remains during expansion but
is not the new init verb.

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
  Both configs are recreated from their TypeScript seeds if missing; existing JSONC
  receives targeted edits preserving unrelated settings and comments.

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
| Typecheck `include` | `["src"]` | add `test`, `tests`, `vitest.config.ts` | add `tsdown.config.ts` |

Both triggers combine; tsdown selects the base module settings, and typecheck includes
both sets of files. Base `include` is always `["src"]`. Typecheck always extends
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
  for both configs in a Node-baseline container with a read-only repository mount.
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
Add the three Forge Ahead runtime dependencies (`@forge-ahead/atlassian-api-types`,
`@forge-ahead/errors`, `@forge-ahead/logging`) from the version registry. Repository URLs
are supported dependency specs.

### `aidev`
Copy a versioned, Forge-focused `AGENTS.md` seed. Create-if-absent; guidance content,
not machine configuration.

### `test`
The testing slot selects Bun's built-in runner for `library` and `tool`, Vitest
for `forge-app`, and no test scripts for `agent-skill`.

- Bun owns `test`, `test:watch`, and `test:coverage` with
  `bun test --pass-with-no-tests`, `bun test --watch --pass-with-no-tests`, and
  `bun test --coverage --pass-with-no-tests`. It needs no test-runner dependency
  or config.
- Vitest owns the same scripts with `vitest run --passWithNoTests`,
  `vitest watch --passWithNoTests`, and
  `vitest run --coverage --passWithNoTests`. `vitest` and `@vitest/coverage-v8`
  are devDependencies at the same exact version (`5.0.3`), both supplied by
  `TOOL_VERSIONS.vitest` so coverage never prompts to install a provider.

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

### `evals` (optional; `--preset all` or `--with evals`)
Add `promptfoo`; own `eval`/`view` scripts. Copy versioned Promptfoo config and example
prompts/tests/data as seed assets; never overwrite an existing evaluation suite.

Manifest wiring is deliberately manual: Drop Calf does not edit `manifest.yml`
for `evals`, because agent selection and behavior belong to the app owner.
`prompts/agent-instructions.md` is the shared prompt source. Seed
`docs/how-to/evaluate-rovo-agent.md` with a `rovo:agent` prompt-resource example
that resolves to that file, already read by the Promptfoo test cases. Keep the
translation example runnable without an agent. Evaluation is a prompt simulation
through the configured provider, not a test of the deployed Rovo runtime.

### `size`
Add `size-limit` and `@size-limit/file`; own the `size` script. Structured-merge a
`size-limit` entry named `Forge app bundle` (`dist/**/*.js`, `10 kB`); same name with
incompatible values is a conflict.

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
  Standalone `copy-git-hooks` deliberately overlays the seed without changing
  package metadata; it is not update.
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
