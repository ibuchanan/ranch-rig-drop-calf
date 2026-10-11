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
  script. Exception: `git-hooks` adoption on existing repositories never claims
  `lint`/`check`.
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
catalog → oss → gitignore → node → changelog → secrets → format → forge-prelint
→ typescript → forge-ahead → aidev → test → evals (optional) → size → git-hooks
```

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
- **update** is an explicit no-op: the catalog module owns the whole file, but no update policy is currently defined. Update neither creates nor rewrites it.
- **validate** checks structural acceptance without policy compliance or remote reference lookup:
  - YAML syntax and duplicate-key detection.
  - Roadie schema validation via `@roadiehq/roadie-backstage-entity-validator`.
  - `kind` must be `Component`.
  - `spec.owner` must be a valid user entity reference.
  - `forge-ranch/copyright-date` annotation (if present): YYYY or YYYY-YYYY with ordered range.
  - Missing `catalog-info.yaml` → skipped with reason.

#### Shared metadata contract

The root `catalog-info.yaml` is the permanent source for metadata consumed by
other modules, independent of language or package manager. This tracked section
records the field contract; scratch tickets only track deferred wiring.

| Value | Catalog field | Consumer |
|---|---|---|
| Catalog identifier | `metadata.name` | Backstage; not a package or display name |
| Project display name | `metadata.title` | OSS README/CONTRIBUTING (ticket 06) |
| Description | `metadata.description` | Package metadata (ticket 04) |
| Responsible user | `spec.owner` | OSS OWNER (ticket 06) |
| Package name | `metadata.annotations["forge-ranch/package-name"]` | Package metadata (ticket 04) |
| Copyright year/range | `metadata.annotations["forge-ranch/copyright-date"]` | OSS LICENSE (ticket 06) |
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
update does not increment it. Standalone `copy-catalog` and `validate-catalog`
functions do not require `package.json`; `copy-catalog` accepts a component type
independently of the currently supported project kinds. Future OSS migration
reads `metadata.title`, the copyright-date annotation, and `spec.owner`, but that
consumer wiring is deferred to ticket 06.

### `oss`
Copy `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`,
`SECURITY.md`, and `.atlassian/OWNER` from the pinned Bitbucket
`vendor/oss-templates` submodule. Substitute only the required staff ID in OWNER,
`[Project name]` in CONTRIBUTING and README, and `[YYYY]` in LICENSE; preserve
all other template bytes. The Apache-2.0 license is fixed. `DEVELOPMENT.md` is
generated separately because it is not in that template.

README remains init-only and survives update. The catalog decision supersedes
ADR 0001's original init-only OWNER example: OWNER is to be derived from the
catalog user owner on both init and update. LICENSE, CODE_OF_CONDUCT, CONTRIBUTING,
and SECURITY are updated authoritatively from the pinned upstream, replacing
owner edits without explicit opt-in. Name substitution uses catalog
`metadata.title`; LICENSE uses `forge-ranch/copyright-date` without advancing
the year. Catalog consumer wiring and the `license` field's verb assignment
remain for the OSS policy slice (ticket 06); introducing catalog does not change
OSS generation yet.
Validate is an explicit no-op: these documents have no consuming tool whose
acceptance OSS checks. Checking owner input is input validation, not repository
validation.

### `gitignore`
Build an ordered `.gitignore` from named sets (`visualstudiocode`, `linux`,
`macos`, `windows`, `node`, `turbo`, `yarn`), first-occurrence de-duplication.
Merge into an existing file by adding absent lines only; preserve user lines.
Set selection is exposed.

The templates are not fetched at generation time: the gitignore.io response is
pinned to `vendor/gitignore` and refreshed deliberately, so output is
deterministic, reviewable, and available offline. The pinned bytes carry a
macOS rule that only matches with literal CR characters, so the file is pinned to
`-text` in `.gitattributes` and refreshed only through
`scripts/refresh-gitignore.ts`. A personal block (`.fallow/`, `.scratch/`,
`.session/`, `vendor/`, `/.cocoindex_code/`) is appended after the selected
sets on initialization and contributed to the merge on update. Initialization
and update share one builder, so the two paths cannot drift.

### `node`
Pin the Node baseline: `.nvmrc` (`24`), `engines.node` (`24.x`), and `@types/node`
(`24`). A different pinned major is a conflict.

Own the npm registry in `.npmrc`: seed `registry=https://registry.npmjs.org/`, add the
key to an existing file without disturbing other lines, and treat a different registry as
a conflict. Scoped keys (`@acme:registry=…`) are distinct and are preserved.

On `forge-app`, reconcile `app.runtime.name` (`nodejs24.x`) against an existing
`manifest.yml`. The manifest belongs to the user: this never creates it, only
fills in or checks the runtime key. A different runtime raises `ConflictError`
with a remedy. Matching values leave the file byte-for-byte unchanged; edits use
a comment-preserving YAML document API, retaining key order, scalar styles,
indentation, comments, and sibling settings such as `memoryMB`, `architecture`,
and `id`. Invalid YAML raises `ParseError` before any output is returned. Other
kinds leave the manifest alone.

**First-time setup exception:** `init`/`init-changes` replaces a runtime
supplied by `forge create`, which may lag the baseline, just as it replaces
invented scaffold package metadata. `init` is not an update command. The pure
reconciliation function and its Dagger boundary default to strict conflict
checking for a future update path.
With `files` retired, init on an empty directory has no manifest to reconcile;
this capability still does not create one. The Node policy slice decides how to
split the existing reconciliation behavior between the required verbs.

The baseline lives in one place (`src/node.ts`) so initialization and update cannot drift;
`.nvmrc` stays bare (`24`) because changing that format would conflict with every
repository already generated.

### `changelog`
Add `git-cliff` dev dependency and the `changelog` script. Seed the release
policy from `templates/changelog/cliff.toml` (authored content, never rebuilt by
the capability) and seed it create-if-absent, so a policy a project has edited is
left alone. Only kinds that ship the `changelog` script are offered it, so
`agent-skill` gets no policy it cannot run.

The script writes `CHANGELOG.md` (`git cliff … -o CHANGELOG.md`), which is seeded
alongside the policy and is regenerated whole, never prepended. The changelog's
prose therefore lives in the policy's `header` key: anything written into the
Markdown by hand would be erased on the next run. The seed is byte-identical to
what the command renders before any release, so a project's first run is a
no-op. Validate a repository by rendering that same command in a container at the
pinned version when it has git history, reporting a skip rather than failing
otherwise.

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
Add `@biomejs/biome` at the version pinned in `TOOL_VERSIONS.biome` and declare
`templates/biome`. Seed its authored `biome.jsonc` verbatim for every kind; the
schema version must match the registry pin, enforced by a test. Generation does
not invoke a local Biome binary, create temporary directories, or build and merge
a config in code. Seed `.editorconfig` from the same tree, with no blueprint
copy or generation exclusion. It contains only `[*]` defaults and a Markdown
`trim_trailing_whitespace = false` override, preserving two-space hard line breaks
allowed by the docs template's default MD009 rule. Standalone `copy-biome` seeds
the same bytes. Owns `format`, `format:check`, `lint:check`,
`lint:fix` scripts.

### `forge-prelint`
Add `@ast-grep/cli` and the Forge rules package, aliased `@forge-ahead/prelint`
(`github:ibuchanan/tool-forge-prelint-ast-grep`). The rules ship inside the package, so
there is no config to author: `lint:prelint` runs `ast-grep scan --globs '!specs/**'
--globs '!node_modules/**' --config ./node_modules/@forge-ahead/prelint/sgconfig.ecosol.yml`.
Add `lint:forge` (`forge lint`) and establish the direct `lint` chain unless `git-hooks`
later owns `lint`. Validate a repository by installing the pinned rules in a container and
running the same scan against it, reporting a skip when the repository never opted into
`lint:prelint`.

### `typescript`
The TypeScript toolchain: the `typescript` devDependency, the `build` and `typecheck`
scripts that invoke it, and the config it reads. `@types/node` belongs to `node`.

Every kind uses the base config, seeded verbatim from `templates/typescript` (copied from the
vendored Forge example) so the JSONC comments explaining which options the bundler forces
survive. `build` and `typecheck` are the only two `tsc` scripts the example uses — a Forge
app is a static resource bundle plus resolvers rather than a running server, so there is no
`dev` script. `tsconfig.typecheck.json` extends the base config with the stricter no-* /
exact flags; it omits `noUnusedLocals`, `noUnusedParameters`, and
`noFallthroughCasesInSwitch` because Biome's recommended set already reports all three.

Only the compiler range was ever different between kinds, and it no longer is: every kind
takes `typescript@^5.9`. `library` additionally overrides `build` with `tsdown` and owns the
publishing fields.

Comments and unrelated settings in an existing config are preserved by never rewriting it:
both configs are seeded create-if-absent, so a `tsconfig` the project already has is left
untouched rather than parsed and edited.

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
- The Vitest capability declares `templates/vitest`. Its config excludes
  `node_modules`, `dist`, `coverage`, and `specs/**`, disables globals in favor of
  explicit imports, and selects the V8 coverage provider. Its typecheck config
  includes `src`, `test`, `tests`, and `vitest.config.ts`, excludes vendored and
  output trees, and uses modern module resolution only for local typechecking.
  The Forge deploy-time `tsconfig.json` remains unchanged.

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
Add `lefthook`. The config is authored content seeded from
`templates/git-hooks/lefthook.yml` (never rebuilt by the capability), so the group
names, commands and gitleaks guard stay reviewable in a diff. One config serves
every kind: `lint` groups the `prelint`/`biome`/`forge`/`typecheck`/`format`
steps, `pre-commit` runs `gitleaks` and `format`, and `pre-push` runs
`lint`/`test`/`size`. The scripts a kind omits (`test` on `agent-skill`, `size`
on `tool`, the Forge lint steps outside `forge-app`) are reached through
`npm run <script> --if-present`, so a hook with nothing to run is a no-op rather
than a failure. Own `prepare` (`lefthook install || true`), `lint`
(`lefthook run lint`) and `check` (`lefthook run pre-push --force`).

Two deliberately different modes:
- **Managed baseline** (no existing `lefthook.yml`): seed the full config and own
  `prepare`, `lint`, `check`.
- **Additive adoption** (existing config): parse the YAML document and merge only a
  compatible named `commands` map — add absent commands, preserve unrelated
  commands and settings, no-op on semantically equivalent commands, conflict on
  semantic mismatch or non-command-map hook structure. Never replace existing
  `lint` and `check` scripts.

## 5. Composition into project kinds

Which functions each project kind selects is specified in
[`01-project-kinds.md`](01-project-kinds.md). The functions themselves are composition
targets only: a kind assembles functions, but the stable script interface above belongs to
the owning functions, never to the kind.

## 6. Error and conflict classes

Failures name the function, affected path, discovered value, wanted value, and a suggested
remedy: `InvalidOptionsError`, `PrerequisiteError`, `ConflictError`, `ParseError`
(no partial mutation on unparseable input), `ValidationError`.
