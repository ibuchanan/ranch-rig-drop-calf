# Project-functions specification

High-level specification of the repository capabilities ("functions") Drop Calf
(`drop-calf`) must implement, extracted from the `vendor/init-repo` design
(`specs/esa-repo-init-spec.md`).

## 1. Purpose

A **project-function** is a repository capability with a stable, project-facing interface
(npm scripts, files, hooks). Functions are selected individually or composed into named
**catalog kinds** (`typescript-library`, `forge-app`, `monorepo`). Each function may select
one or more **tools** (`biome`, `lefthook`, `git-cliff`, `vitest`, …); a tool is an
implementation choice, a function is the capability.

## 2. Function contract

Every function:

- has a unique `name`;
- declares `dependsOn` and `conflictsWith` (edges in the function graph);
- **plans before mutating**: all operations (file edits, commands, installs, conflicts) are
  recorded in a plan builder first; untracked direct writes are forbidden;
- is **idempotent**: applying it twice produces no semantic change on the second run;
- may expose `validate()` for post-apply checks.

## 3. Cross-cutting invariants

- **Mutation modes** classify every output: `create-if-absent`, `replace-generated`
  (only with an explicit, plan-visible `--force` strategy), `structured-merge`
  (owned keys only, preserve unknown fields), `managed-region`, `copy-tree-if-empty`,
  `executable-seed`.
- **Script ownership is stable.** Only the owning function may replace its canonical npm
  script; drift is a conflict, not a silent overwrite. Exception: `git-hooks` adoption on
  existing repositories never claims `lint`/`check`.
- **Merging preserves user content.** Existing files are merged in place where safely
  supported; otherwise reported as conflicts. Never create `package.json.orig`.
- **Versions are centralized** in one catalog-version registry; no function carries a
  duplicated version constant.
- **Seed assets are versioned authored content** copied with collision detection; user
  modifications are never silently overwritten.
- Every mutating command: discover → plan → surface conflicts → apply in dependency order →
  validate → append a journal event.

## 4. The functions

Default order (dependency/precedence graph may encode it via `before`/`after`):

```text
oss → gitignore → node → changelog → secrets → format → forge-prelint
→ typescript → forge-ahead → aidev → test → evals (optional) → size → git-hooks
```

### `oss`
Copy `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `README.md`,
`SECURITY.md`, and `.atlassian/OWNER` from the pinned Bitbucket
`vendor/oss-templates` submodule. Substitute only the required staff ID in OWNER,
`[Project name]` in CONTRIBUTING and README, and `[YYYY]` in LICENSE; preserve
all other template bytes. The Apache-2.0 license is fixed. `DEVELOPMENT.md` is
generated separately because it is not in that template. Seed files are
create-if-absent on sync, preserving existing user content.

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
sets on generation and contributed to the merge on sync. Merge and generation
share one builder, so the two paths cannot drift.

### `node`
Pin the Node baseline: `.nvmrc` (`24`), `engines.node` (`24.x`), and `@types/node`
(`24`). A different pinned major is a conflict.

Own the npm registry in `.npmrc`: seed `registry=https://registry.npmjs.org/`, add the
key to an existing file without disturbing other lines, and treat a different registry as
a conflict. Scoped keys (`@acme:registry=…`) are distinct and are preserved.

On `forge-app`, reconcile `app.runtime.name` (`nodejs24.x`) against an existing
`manifest.yml`. The manifest belongs to the user: this never creates it, only fills in or
checks the runtime key, and a different runtime is a conflict. Other kinds leave it alone.

The baseline lives in one place (`src/node.ts`) so generation and sync cannot drift;
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
the seeded list is empty. `sync` seeds the tree create-if-absent for `forge-app` only, so
an edited config or helper is left alone. Secretspec and Gitleaks are external
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
