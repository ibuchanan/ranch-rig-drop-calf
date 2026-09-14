# Project-functions specification

High-level specification of the repository capabilities ("functions") this project must
implement, extracted from the `vendor/init-repo` design (`specs/esa-repo-init-spec.md`).

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
Copy versioned seed assets (`LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`README.md`, `DEVELOPMENT.md`, `.atlassian/OWNER`). Substitute project name, year, and
owner only in designated tokens/managed regions. Create-if-absent.

### `gitignore`
Build an ordered `.gitignore` from named sets (`visualstudiocode`, `linux`, `macos`,
`windows`, `node`, `turbo`, `atlassian`), first-occurrence de-duplication. Merge into an
existing file by adding absent lines only; preserve user lines. Set selection is exposed.

### `node`
Pin the Node baseline: `.nvmrc` (`24`) and `engines.node` (`24.x`). A different pinned
major is a conflict.

### `changelog`
Add `git-cliff` dev dependency and the `changelog` script. Use a versioned `cliff.toml`
seed (authored release policy). Validate via `git cliff --config cliff.toml --unreleased`
when git history and tool availability permit.

### `secrets`
Generate a minimal `secretspec.toml` (project name; default `FORGE_SITE`,
`FORGE_PRODUCT`, `FORGE_ENVIRONMENT`) and an executable helper that derives variable
names from the TOML, runs under `secretspec run`, skips `FORGE*` names, pushes `SECRET`-
containing names as encrypted Forge variables and others as normal variables, and never
prints secret values. Add/merge Forge scripts that wrap `forge` through
`secretspec run -- ...` (this quoting is functional). `doctor` reports Secretspec and
Gitleaks as external prerequisites; never installed, never injected.

### `format`
Add `@biomejs/biome`. Invoke `biome init` when config is absent and the tool is locally
available; otherwise create equivalent minimal JSON procedurally. Deep-merge required VCS,
file-exclusion, and formatter policy (schema version must match the installed Biome
version). Create `.editorconfig` as a small deterministic text asset. Owns
`format`, `format:check`, `lint:check`, `lint:fix` scripts.

### `forge-prelint`
Add `@ast-grep/cli` and the Forge prelint rules package. Add the `lint:prelint` scan
command and establish the direct `lint` chain (unless `git-hooks` later owns `lint`).

### `typescript`
Add `typescript@^5` (Forge-bundler constraint) and `@types/node`; own `build`, `dev`,
`typecheck` scripts. Two profiles:
- **forge-app**: JSONC `tsconfig.json` (JSX react-jsx, ES2022, CommonJS, Node resolution,
  strict, `src` root / `dist` out) plus a `tsconfig.typecheck.json` extending it with the
  stricter no-* / exact flags; `build`/`dev` run `tsc`.
- **typescript-library**: separate library config; build owned by `tsdown`.

Comments and unrelated settings are preserved (JSONC-aware editor, never regex).

### `forge-ahead`
Add the three Forge Ahead runtime dependencies (`@forge-ahead/atlassian-api-types`,
`@forge-ahead/errors`, `@forge-ahead/logging`) from the version registry. Repository URLs
are supported dependency specs.

### `aidev`
Copy a versioned, Forge-focused `AGENTS.md` seed. Create-if-absent; guidance content,
not machine configuration.

### `test`
Add `vitest` and `archunit`; own `test`, `test:watch`, `test:coverage` scripts. Create
`vitest.config.ts` via a semantic AST procedure if absent (never overwrite an existing
one). Copy the Forge architecture-test seed tree only into absent paths; report
collisions per file.

### `evals` (optional; `--preset all` or `--with evals`)
Add `promptfoo`; own `eval`/`view` scripts. Copy versioned Promptfoo config and example
prompts/tests/data as seed assets; never overwrite an existing evaluation suite.

### `size`
Add `size-limit` and `@size-limit/file`; own the `size` script. Structured-merge a
`size-limit` entry named `Forge app bundle` (`dist/**/*.js`, `10 kB`); same name with
incompatible values is a conflict.

### `git-hooks`
Add `lefthook`. Two deliberately different modes:
- **Managed baseline** (no existing `lefthook.yml`): create the full config (`esa-lint`
  command group; `esa-gitleaks` + `esa-format` pre-commit; `esa-format-check`/`esa-lint`/
  `esa-test` pre-push) and own `prepare`, `lint`, `check` (`lint`/`check` become
  `lefthook run` commands).
- **Additive adoption** (existing config): parse the YAML document and merge only a
  compatible named `commands` map — add absent `esa-*` commands, preserve unrelated
  commands and settings, no-op on semantically equivalent `esa-*` commands, conflict on
  semantic mismatch or non-command-map hook structure. Never replace existing `lint` and
  `check` scripts.

## 5. Composition into project kinds

Which functions each project kind selects is specified in
[`01-project-kinds.md`](01-project-kinds.md). The functions themselves are composition
targets only: a kind assembles functions, but the stable script interface above belongs to
the owning functions, never to the kind.

## 6. Error and conflict classes

Failures name the function, affected path, discovered value, wanted value, and a suggested
remedy: `InvalidOptionsError`, `PrerequisiteError`, `ConflictError`, `ParseError`
(no partial mutation on unparseable input), `ValidationError`.
