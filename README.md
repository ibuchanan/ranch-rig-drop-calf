# Drop Calf

The **Forge Ranch** is a way to tend a portfolio of independent Forge apps
without letting each repo become a one-off maintenance burden.
New projects should inherit a consistent starting point:
scripts, checks, and configuration.
That helps a small team focus on building and looking after the apps.

**Drop Calf** is part of the _calving pen_:
where a new project joins the herd.
This Dagger module generates
a starter TypeScript repository
from a project profile,
assembling scripts, dependencies, and configuration
from small capabilities
rather than copying a fixed template.

**Status:** Early implementation. Initialization, update, and read-only validation
are available. Every current capability has an explicit init, update, and
validate implementation or documented no-op. The broader project functions
in the [specifications](specs/00-drop-calf-overview.md) are not all implemented.

## Choose the operation

- **`init` once:** Set up an empty directory or a fresh `forge create` scaffold.
  Prefer `init-changes` when exporting, so scaffold deletions reach disk.
  Both refuse before cleanup or generation if `catalog-info.yaml` or
  `.atlassian/OWNER` exists at the project root, regardless of file contents,
  and point you to `update`. These are presence gates, not proof that a directory
  without either marker is a fresh scaffold.
- **`update` to converge on policy:** Maintain an existing repository with the
  selected capabilities' implemented update policies, without rerunning scaffold
  cleanup or init-only template seeding. Review the changes before exporting.
  For a guarded repo missing `catalog-info.yaml`, follow the
  [existing-repository adoption guide](docs/how-to/adopt-existing-repository.md)
  before updating.
- **`validate` to check:** Get a read-only report of tool acceptance and explicit
  skipped or failed checks. It does not apply fixes or guarantee policy compliance.

## Set up a new Forge app

You need the [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/),
the [Dagger CLI](https://docs.dagger.io/install/) with a running engine, and
npm. Dagger fetches Drop Calf from GitHub, so you do not need a checkout of
this repository.
1. Create the app. `forge create` registers it in your developer space and
   supplies `manifest.yml` and `src/`:

   ```bash
   forge create my-app
   cd my-app
   ```

2. Preview the changes. Pass your Atlassian staff ID as `--owner`:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf init-changes \
     --directory . --profile forge-app --owner your-staff-id
   ```

   `init-changes` removes the scaffold files Drop Calf replaces, generates
   the `forge-app` files over what is left, and keeps the app's own
   `dependencies`, `main`, `private`, and package name. Generated keys win on
   conflict. On `forge-app`, the scaffold's `app.runtime.name` is set to
   `nodejs24.x` to match the local Node baseline; the manifest's other settings
   are preserved. Root `src/` JavaScript files are renamed from `.js` to `.ts`
   and `.jsx` to `.tsx`, with matching manifest resource paths updated. Source
   contents and Custom UI `static/` projects are unchanged. Strict checking stays
   enabled: fix any type errors the conversion exposes. Destination collisions
   refuse initialization rather than overwrite files. This is first-time setup;
   `update` never renames source.

3. Apply the same changes to the working tree, then install:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf init-changes \
     --directory . --profile forge-app --owner your-staff-id export --path .
   npm install
   ```

4. Fill in the generated `README.md` and review `CONTRIBUTING.md`; both are
   templates. Fix type errors exposed by adopting scaffold JavaScript as TypeScript.

5. Verify the initialized project. Use Node 24 locally. `npm run check` uses
   `run-p` for lint, tests, and build/size/package checks where present; lint
   includes typecheck and format checks. Lefthook's pre-push hook calls `check`.
   This is a workflow check, not Drop Calf validation.

   ```bash
   npm run check
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf validate \
     --directory . --profile forge-app \
     --forge-email env://FORGE_EMAIL --forge-api-token env://FORGE_API_TOKEN
   ```

   Supply your Forge email/token in those environment variables; Dagger passes
   them as Secrets only to Forge lint. Local Forge checks also need Forge CLI
   authentication; `forge:*` scripts run through [Fence Rider](https://github.com/ibuchanan/ranch-rig-fence-rider),
   which needs [SecretSpec](https://secretspec.dev), Bun and the owner-configured secret provider. The generated docs describe that setup.
   `validate` returns a JSON report: inspect every `failed` result and every
   `skipped` reason rather than treating the CLI exit status as proof of success.
   Deliberate no-op skips are expected. No registration or deployment runs here.

Dagger uploads the directory you pass, including the `node_modules` that
`forge create` installed. Delete it first if the upload is slow.

Use `init-changes`, not `init ... export`: `init` returns a plain directory,
and Dagger's export merges by default, so the removed scaffold files would
stay on disk. Do not add `--wipe` in an existing repository; it also deletes
unrelated files.

## Start without a scaffold

Use the same first-time setup for `library`, `tool`, `agent-skill`, or a
`forge-app` you did not start with `forge create`. Create an empty directory,
then preview and export the changes:

```bash
mkdir my-library
cd my-library
dagger call -m github.com/ibuchanan/ranch-rig-drop-calf init-changes \
  --directory . --profile library --owner your-staff-id
dagger call -m github.com/ibuchanan/ranch-rig-drop-calf init-changes \
  --directory . --profile library --owner your-staff-id export --path .
```

Choose the profile you need. Empty-directory setup does not create source
files, a Forge manifest, or an app registration; add those before building.
There is no separate `files` operation.

Complete setup by adding source (for a library, `src/index.ts`), selecting Node 24,
and ensuring [Bun](https://bun.com/docs/installation) is on PATH for non-Forge tests.
Then install and verify the same profile you initialized:

```bash
npm install
npm run check
dagger call -m github.com/ibuchanan/ranch-rig-drop-calf validate \
  --directory . --profile library
```

`npm run check` can fail on owner source, formatting, or bundle budgets; an empty
starter is not promised to pass. Inspect the validation JSON for failed checks and
skipped reasons. Forge apps require the credential inputs shown above. If you
selected optional capabilities at init, pass the same selection flags to validate.

## What you get

The result is a starter configuration, **not a complete runnable
application**: scripts, checks, and configuration, without source files or
installed dependencies.
- **Profiles:** `library`, `forge-app`, `tool`, and `agent-skill`.
  `--profile` is required; an unknown or ambiguous name fails before anything
  is generated.
- **OSS files:** `LICENSE` (Apache-2.0), `README.md`, `CONTRIBUTING.md`,
  `CODE_OF_CONDUCT.md`, `SECURITY.md`, and `.atlassian/OWNER`, copied from a
  pinned copy of Atlassian's OSS templates. `--owner` fills `OWNER`, the
  project name fills `[Project name]`, and the current year fills `[YYYY]`.
- **Node baseline:** Node 24 in `.nvmrc` and `@types/node` (init-only), plus an `.npmrc`
  pinning the public npm registry, which is not the default inside Atlassian.
  `engines` is not set in `package.json` due to compatibility with `forge deploy`.
- **Forge manifest:** On Forge apps, runtime update derives `app.runtime.name`
  from `.nvmrc`, giving `nodejs24.x` after Node's update. Other settings survive.
- **`.gitignore`:** assembled from pinned gitignore.io templates, so output is
  deterministic and generation works offline.

Common options:
- Package naming for `init` and `init-changes`: explicit `--package-name`
  first, then a nonblank scaffold `package.json` name, then the Dagger
  workspace directory name (the current directory in the examples above).
- `--description` sets the package and catalog description; `--owner` is also
  the package author.
- `--with-functions evals` or `--preset all` adds evaluation scripts on
  `forge-app`; `--without-functions evals` excludes them from `--preset all`.
- `--without-functions aidev` omits the `AGENTS.md` guidance seed.

Core profile capabilities cannot be removed.

### Capability reference

Rows with identical behavior are grouped by kind; different implementations stay
separate. Selection applies to all three verbs. **Top-level `init` seeds first,
then runs every selected update**: a capability init no-op does not mean its
update-managed scripts or dependencies are absent from the initialized project.
Validate checks tool acceptance, not policy compliance; missing prerequisites may
produce additional skipped or failed results beyond the deliberate no-ops below.

<details>
<summary>All capabilities, tools, and init/update/validate behavior</summary>

<!-- capability-reference:start -->
<!-- Generated by bun run scripts/refresh-capability-docs.ts; do not edit this block. -->
<!-- biome-ignore format: generated table -->
| Kinds | Capability | Selection | Tool / purpose | Capability init | Update | Validate |
|---|---|---|---|---|---|---|
| `library`, `forge-app`, `tool`, `agent-skill` | `catalog` | Required | [Backstage Entity Validator](https://www.npmjs.com/package/@roadiehq/roadie-backstage-entity-validator) — Validates catalog-info.yaml component entities against Backstage schema | Seeds catalog-info.yaml with project metadata from package.json and CLI inputs | **No-op:** Catalog owns the file, but no update policy is defined. | Check YAML and Backstage Component structure, user owner reference, and optional copyright-date format; no remote lookup. |
| `library`, `tool` | `package-metadata` | Required | [npm-package-json-lint](https://www.npmjs.com/package/npm-package-json-lint) — Checks package metadata field types and formats with explicit structural rules.<br>[npm](https://docs.npmjs.com/cli/) — Reference for package.json schema and metadata format | **No-op:** Package metadata owns no files; its package.json contribution seeds version 0.1.0, type module, and private true; initialization supplies the initial package name. | Derive name/description/author from catalog; enforce type module, preserving owner privacy and release version. | Check metadata field types/formats with explicit structural rules, not policy compliance. |
| `library`, `forge-app`, `tool`, `agent-skill` | `oss` | Required | [Apache License 2.0 / pinned Atlassian OSS templates](https://www.apache.org/licenses/LICENSE-2.0) — Supplies licensing, contribution, conduct, security, README, and ownership documents; no executable tool. | Seed LICENSE, README.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, and .atlassian/OWNER with catalog metadata. | Replace authoritative OSS documents and OWNER from pinned templates and catalog metadata; preserve README edits/deletion. | **No-op:** These documents require manual inspection; no consuming validator checks their acceptance. |
| `library`, `forge-app`, `tool`, `agent-skill` | `gitignore` | Required | [gitignore.io](https://www.gitignore.io/) — Provides template rules for Node, TypeScript, Forge, and other tool ecosystems | Seed two owned blocks from pinned gitignore.io topics and Drop Calf defaults, retaining unowned scaffold rules. | Replace existing owned blocks from recorded topics/pinned defaults; preserve bytes outside blocks and do not seed missing blocks. | **No-op:** Git treats ineffective ignore patterns as nonmatching; checking which paths are ignored would enforce policy, not tool acceptance. |
| `library` | `node` | Required | [fnm (Fast Node Manager)](https://github.com/Schniz/fnm) — Selects and, when needed, installs the Node version requested by .nvmrc.<br>[Node.js](https://nodejs.org/) — Reference for Node.js versions and TypeScript type definitions | Seed Node 22 .nvmrc, public-registry .npmrc, and @types/node; no engines declaration. | Replace .nvmrc/.npmrc and derive package license from catalog; preserve engines and constrain declared @types/node ranges to major 22. | Use fnm to select .nvmrc (may download Node); no baseline, type-version, or deployment check. |
| `library`, `forge-app`, `tool`, `agent-skill` | `changelog` | Required | [git-cliff](https://git-cliff.org/) — Renders unreleased changelog from commit history and release policy | Seeds cliff.toml release policy and CHANGELOG.md from templates; adds changelog script to package.json | **No-op:** Release policy and CHANGELOG.md are owner-managed after init; its package.json contribution enforces the changelog command and keeps the seeded git-cliff dependency fresh. | Validates cliff.toml policy and runs git-cliff command against repository commit history |
| `library`, `tool`, `agent-skill` | `release` | Required | [git-cliff](https://git-cliff.org/) — Derives release versions and notes using the changelog capability's shared pin and owner-managed cliff.toml. | Seed release:check and a short, package-manager-specific Bash script that releases main to origin with checks, version and notes updates, commit, tag, and atomic push only on explicit invocation. | Maintain release and its Bash script; supply a missing release:check while preserving owner checks, versions, lockfiles, notes, and cliff.toml. Never release during maintenance. | **No-op:** Git release is an explicit maintainer workflow; standalone validation does not change versions or notes, run checks, commit, tag, or push. |
| `library`, `forge-app`, `tool`, `agent-skill` | `biome` | Required | [Biome](https://biomejs.dev/) — Formats and lints JavaScript, TypeScript, and supported configuration files. | Seed Biome, formatting/lint subtasks, biome.jsonc, and .editorconfig. | Let Biome migrate an existing root config, preserving EditorConfig. | Load the root config and references with Biome, without scanning source quality. |
| `library`, `forge-app`, `tool`, `agent-skill` | `lint` | Required | [npm-run-all2](https://github.com/bcomnes/npm-run-all2) — Runs lint:check:* scripts and the lint/test/size/package check workflow in parallel, independently of Git hooks. | **No-op:** Lint owns no files; its package.json contribution seeds npm-run-all2 and supplies the lint and check aggregates. | **No-op:** Lint owns no files; its package.json contribution enforces the lint and check aggregates and keeps the seeded runner fresh. | **No-op:** Lint has no configuration file; source checks belong to the lint workflow, not capability validation. |
| `library` | `library-build` | Required | [tsdown](https://tsdown.dev/) — Bundles a TypeScript library as ESM and CommonJS with declaration output. | Seed tsdown, the build pipeline/config, and publishing fields. | Enforce the build script and ESM/CommonJS formats; preserve owner entry/dependency settings. | **No-op:** tsdown has no supported configuration-only validation interface: resolveUserConfig is internal and no-write still bundles source. Build and declaration emission belong to the build workflow; validation does not execute the pipeline or inspect stale artifacts. |
| `library` | `package-check` | Required | [Publint](https://publint.dev/) — Checks packed library conventions with warnings treated as errors.<br>[Are the Types Wrong?](https://arethetypeswrong.github.io/) — Checks TypeScript declaration resolution against the consumer package. | Seed exact checker dependencies and the lifecycle-free tarball checking script; checker configuration remains owner-managed. | Enforce pack:check and its script; keep existing checker dependencies fresh without re-adding removed tools. Preserve publishing metadata, checker configuration, and hook edits. | **No-op:** Package checks require fresh build artifacts and belong to the developer pack:check workflow; standalone validation does not build or inspect stale distributables. |
| `library`, `tool`, `agent-skill` | `typescript` | Required | [TypeScript](https://www.typescriptlang.org/docs/) — Type-checks source and emits JavaScript or library declarations. | Seed TypeScript, typecheck, and compiler configuration; the selected build capability owns build (declarations only with tsdown). | Reconcile compiler configuration with policy selected by declared dependencies. | Run tsc --showConfig for applicable compiler configs, without compiling source or declarations. |
| `library`, `tool`, `agent-skill` | `test` | Required | [Bun test](https://bun.com/docs/test) — Runs library, tool, and agent-skill tests with built-in watch and coverage support. | **No-op:** Seed @types/bun for test typechecking and supply test scripts; test sources remain owner-managed. | **No-op:** Bun testing owns no files; its package.json contribution enforces test scripts and keeps @types/bun fresh, preserving owner test sources. | **No-op:** This capability owns no Bun test configuration to validate. Test execution belongs to the test workflow; comparing scripts to defaults would check policy, not tool acceptance. |
| `library`, `tool` | `fallow` | Default; `--without-functions fallow` | [Fallow](https://docs.fallow.tools/) — Checks unused code, dependencies, duplication, and complexity. | Seed Fallow, lint:check:fallow, and an owner-managed config for tool and library projects. | **No-op:** Fallow config is owner-managed after init, including deletion; its package.json contribution enforces lint:check:fallow and keeps the seeded dependency fresh. | **No-op:** Fallow has no configuration-only check; source analysis belongs to lint:check:fallow, not capability validation. |
| `library` | `clean-build` | Required | [rm](https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html) — Removes node_modules, package-lock.json, and dist when the owner runs the clean workflow. | **No-op:** Clean build owns no files to seed; its package.json contribution supplies the clean script. | **No-op:** Clean build owns no files; its package.json contribution enforces scripts.clean as rm -rf node_modules package-lock.json dist and never executes it. | **No-op:** Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow. |
| `library`, `forge-app`, `tool`, `agent-skill` | `todo` | Required | [Git grep](https://git-scm.com/docs/git-grep) — Lists TODO markers in tracked files with paths and line numbers. | **No-op:** Todo owns no files; its package.json contribution seeds scripts.todo for every kind. | **No-op:** The seeded todo script is owner-managed after init; update does not replace or re-add it. | **No-op:** Todo owns no configuration with a separate tool-acceptance check; owners run the script in their Git repository. |
| `library`, `forge-app`, `tool`, `agent-skill` | `docs` | Required | [markdownlint-cli2](https://github.com/igorshubovych/markdownlint-cli2) — Lints markdown files against consistent style rules<br>[CSpell](https://cspell.org/) — Spell-checks documentation and code comments | Seed Markdown/spelling tools and lint:docs, configs, DEVELOPMENT.md, and Diátaxis/spec starter documents. | **No-op:** Docs configuration and documents are owner-managed after init, including deletions; its package.json contribution enforces lint:docs and keeps the seeded tool dependencies fresh. | Load Markdown/spelling configs and references without scanning documentation quality. |
| `library` | `git-hooks` | Required | [Lefthook](https://lefthook.dev/) — Runs Git hooks from lefthook.yml, with pre-push delegating to the check script.<br>[Gitleaks](https://github.com/gitleaks/gitleaks) — Scans staged changes for secrets in the pre-commit hook; install separately. | Seed Lefthook, build-before-hooks prepare, and lefthook.yml delegating pre-push to check. | **No-op:** Hook configuration is owner-managed after init; its package.json contribution enforces prepare and keeps the seeded Lefthook dependency fresh. | Run lefthook validate with isolated Git metadata; never install or execute hooks. |
| `library` | `aidev` | Default; `--without-functions aidev` | [AGENTS.md](https://agents.md/) — Gives coding agents repository-specific instructions; human guidance, not executable config. | Seed authored agent guidance from templates/aidev/library in AGENTS.md. | **No-op:** Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md. | **No-op:** AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance. |
| `forge-app`, `agent-skill` | `package-metadata` | Required | [npm-package-json-lint](https://www.npmjs.com/package/npm-package-json-lint) — Checks package metadata field types and formats with explicit structural rules.<br>[npm](https://docs.npmjs.com/cli/) — Reference for package.json schema and metadata format | **No-op:** Package metadata owns no files; its package.json contribution seeds version 0.1.0, type module, and private true; initialization supplies the initial package name. | Derive name/description/author from catalog; enforce type module and private true, preserving release version. | Check metadata field types/formats with explicit structural rules, not policy compliance. |
| `forge-app` | `node` | Required | [fnm (Fast Node Manager)](https://github.com/Schniz/fnm) — Selects and, when needed, installs the Node version requested by .nvmrc.<br>[Node.js](https://nodejs.org/) — Reference for Node.js versions and TypeScript type definitions | Seed Node 24 .nvmrc, public-registry .npmrc, and @types/node; no engines declaration. | Replace .nvmrc/.npmrc, derive package license from catalog, and remove engines; keep @types/node fresh. | Use fnm to select .nvmrc (may download Node); no baseline, type-version, or deployment check. |
| `forge-app` | `forge-manifest` | Required | [Forge CLI](https://developer.atlassian.com/platform/forge/cli-reference/) — Lints Forge manifests and app source against platform requirements. | **No-op:** The Forge manifest is supplied by forge create or the owner; Drop Calf does not seed app identity or module wiring. | Derive app.runtime.name from numeric .nvmrc in an existing manifest; preserve other settings. | Run pinned forge lint, including source checks, with supplied dependencies and explicit Forge credentials; no fixes or deployment. |
| `forge-app` | `secrets` | Required | [Fence Rider](https://github.com/ibuchanan/ranch-rig-fence-rider) — Wraps the Forge CLI so each workflow runs with values resolved from secretspec.toml and uploads runtime variables encrypted<br>[SecretSpec](https://secretspec.dev) — Declares local, manifest and runtime variables once and resolves them from each developer's chosen provider<br>[Atlassian Forge CLI](https://developer.atlassian.com/platform/forge/cli-reference/) — Reference for forge register, deploy, install, and upgrade command syntax | Seed owner SecretSpec declarations and the six forge:* scripts that delegate to Fence Rider. | **No-op:** Secrets owns only owner declarations; its package.json contribution enforces the forge:* scripts, and the Fence Rider GitHub reference is owner-managed. | Parse TOML, check the default profile and that scope members are declared; no secret resolution or Forge execution. |
| `forge-app` | `prelint` | Required | [ast-grep](https://ast-grep.github.io/) — AST-based pattern scanner for semantic code analysis and linting<br>[@forge-ahead/prelint](https://github.com/ibuchanan/tool-forge-prelint-ast-grep) — Forge app linting rules for manifest, module wiring, and handler patterns | **No-op:** Prelint has no repository-local configuration to seed; its rules ship in the dependency package, and its package.json contribution supplies the tool dependencies and scripts. | **No-op:** Prelint owns no files; its package.json contribution enforces the lint subtasks and keeps the seeded ast-grep dependency fresh; the @forge-ahead/prelint GitHub reference is owner-managed. | **No-op:** Prelint has no repository-local configuration to validate; its rules ship in the dependency package. Source scanning belongs to the lint workflow. |
| `forge-app` | `test` | Required | [Vitest](https://vitest.dev/) — Runs Forge app tests with mocking and V8 coverage support. | Seed Vitest, matching V8 coverage, test/watch/coverage scripts, and vitest.config.ts; no sample tests. | **No-op:** Vitest configuration and test sources are owner-managed after init; its package.json contribution enforces the test scripts and keeps the seeded runner and coverage provider fresh. | Load Vitest config, discover test files, and initialize coverage configuration without executing tests. |
| `forge-app` | `typescript` | Required | [TypeScript](https://www.typescriptlang.org/docs/) — Type-checks source and emits JavaScript or library declarations. | Seed TypeScript, typecheck/build scripts, and compiler configuration (declarations config only with tsdown). | Reconcile compiler configuration with policy selected by declared dependencies. | Run tsc --showConfig for applicable compiler configs, without compiling source or declarations. |
| `forge-app` | `forge-ahead` | Required | [Forge Ahead API types](https://github.com/ibuchanan/forge-ahead-atlassian-api-types) — Provides types for Atlassian API integration in Forge apps.<br>[Forge Ahead errors](https://github.com/ibuchanan/forge-ahead-errors) — Provides typed error handling at Forge boundaries.<br>[Forge Ahead logging](https://github.com/ibuchanan/forge-ahead-logging) — Provides logging helpers for Forge apps. | **No-op:** Forge Ahead owns no files; its package.json contribution seeds the API types, errors, and logging dependencies. | **No-op:** Forge Ahead owns no files; its seeded dependencies are owner-managed and kept fresh against their pins, which skips GitHub references. | **No-op:** Forge Ahead dependencies have no repository-local configuration to validate; comparing dependency references would check policy, not tool acceptance. Runtime integration belongs to the app's build and test workflows. |
| `forge-app` | `size-limit` | Required | [Size Limit](https://github.com/ai/size-limit) — Measures built file sizes against owner-managed budgets with @size-limit/file. | **No-op:** Size Limit owns no files; its package.json contribution seeds the paired tools, the build-then-measure size:check script, and a 10 kB budget for dist/**/*.js. | Enforce size:check and keep the seeded paired tools fresh, preserving owner budgets and paths. Remove the legacy size script only when it matches the former policy command; preserve owner-authored commands. | **No-op:** Size Limit has no supported configuration-only validation interface. Measurement requires build artifacts and belongs to the size workflow; validation does not build the project or assess potentially stale output. |
| `forge-app`, `tool`, `agent-skill` | `clean-build` | Required | [rm](https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html) — Removes dist when the owner runs the clean workflow. | **No-op:** Clean build owns no files to seed; its package.json contribution supplies the clean script. | **No-op:** Clean build owns no files; its package.json contribution enforces scripts.clean as rm -rf dist and never executes it. | **No-op:** Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow. |
| `forge-app`, `tool`, `agent-skill` | `git-hooks` | Required | [Lefthook](https://lefthook.dev/) — Runs Git hooks from lefthook.yml, with pre-push delegating to the check script.<br>[Gitleaks](https://github.com/gitleaks/gitleaks) — Scans staged changes for secrets in the pre-commit hook; install separately. | Seed Lefthook, prepare, and lefthook.yml delegating pre-push to check. | **No-op:** Hook configuration is owner-managed after init; its package.json contribution enforces prepare and keeps the seeded Lefthook dependency fresh. | Run lefthook validate with isolated Git metadata; never install or execute hooks. |
| `forge-app`, `agent-skill` | `evals` | Opt-in; `--with-functions evals`; `--without-functions evals`; `--preset all` | [Promptfoo](https://www.promptfoo.dev/docs/) — Evaluates prompts against authored test cases and displays results. | Seed Promptfoo, eval/view scripts, and the config/prompts/tests/data/guide tree; no manifest wiring. | **No-op:** The eval suite is owner-managed after init, including deletions; its package.json contribution enforces the eval/view scripts and keeps the seeded Promptfoo dependency fresh. | Use Promptfoo's native config/schema validator to load suite references; no model calls or assertion execution. |
| `forge-app` | `aidev` | Default; `--without-functions aidev` | [AGENTS.md](https://agents.md/) — Gives coding agents repository-specific instructions; human guidance, not executable config. | Seed authored agent guidance from templates/aidev/forge-app in AGENTS.md. | **No-op:** Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md. | **No-op:** AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance. |
| `tool`, `agent-skill` | `bun` | Required | [Bun](https://bun.com/docs) — Runs TypeScript tools, installs dependencies, and executes package scripts. | Seed the Bun packageManager pin and bunfig.toml with the public registry and Bun script runtime; no Node version or type pin. | Maintain the Bun packageManager pin and derive package license from catalog; preserve owner-managed Bun configuration and existing Node files. | Parse bunfig.toml as TOML without starting Bun, loading preloads, or installing dependencies; syntax validation does not check Bun option semantics. |
| `tool` | `bun-build` | Required | [Bun compiler](https://bun.com/docs/bundler/executables) — Compiles a TypeScript CLI into a standalone executable for the current platform. | **No-op:** Bun build owns no source files; its package.json contribution supplies binary compilation from src/index.ts to dist/cli. | **No-op:** Bun build owns no files; its package.json contribution enforces the binary build command without compiling source. | **No-op:** Bun compilation executes source bundling and emits a binary; it belongs to the build workflow, not configuration validation. |
| `tool` | `aidev` | Required | [AGENTS.md](https://agents.md/) — Gives coding agents repository-specific instructions; human guidance, not executable config. | **No-op:** No authored agent guidance is selected for this project kind. | **No-op:** Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md. | **No-op:** AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance. |
| `agent-skill` | `citation` | Required | [Citation File Format](https://citation-file-format.github.io/) — Lets people and tools cite the project from machine-readable metadata. | Seed CITATION.cff from the package name, description, version, and owner, with the catalog license. | **No-op:** Citation metadata is owner-managed after init, including deletion; update never overwrites authors, version, or abstract. | **No-op:** CITATION.cff schema validation needs cffconvert, which Drop Calf's tool containers do not run; the agent-skills-toolkit validate-cff check covers it once installed. |
| `agent-skill` | `skill-toolkit` | Required | [agent-skills-toolkit](https://github.com/ibuchanan/agent-skills-toolkit) — Scaffolds skills under skills/ and checks SKILL.md frontmatter, references, and prompts. | **No-op:** Skill toolkit owns no files; skills are created with skill:new, and its package.json contribution supplies the toolkit dependency and scripts. | **No-op:** Skill toolkit owns no files; its package.json contribution enforces the skill scripts, and the toolkit GitHub reference is owner-managed. | **No-op:** Skill toolkit has no repository-local configuration to validate; skill checks belong to the lint workflow, not capability validation. |
| `agent-skill` | `skill-starter` | Required | [Agent Skills](https://agentskills.io/) — Defines the SKILL.md package format that the starter skill, its spec, and the scripts follow. | Seed src/scripts with one Bun script, its test, the first skill under skills/, and that skill's spec in the agent-skills-toolkit style. | **No-op:** Skills, specs, scripts, and tests are owner-managed after init, including deletions; update never restores the starter skill. | **No-op:** Skill structure is checked by the lint:check:skills producer from skill-toolkit, not by capability validation. |
| `agent-skill` | `aidev` | Default; `--without-functions aidev` | [AGENTS.md](https://agents.md/) — Gives coding agents repository-specific instructions; human guidance, not executable config. | Seed authored agent guidance from templates/aidev/agent-skill in AGENTS.md. | **No-op:** Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md. | **No-op:** AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance. |
<!-- capability-reference:end -->

</details>

The [functions specification](specs/02-project-functions.md#capability-verb-reference)
contains the same reference plus detailed ownership and preservation rules.
For library artifact verification and declaration compatibility, see
[Check a library package](docs/how-to/check-library-package.md).

## Repository Git workflows

Use the local launcher to initialize or update a checkout with containerized Git
operations. Init records the scaffold and transformation separately. Update retains
an update branch and a non-fast-forward merge. Both can export bundles for preview;
remote update can publish the update branch and merged target without a PR.

See [Run repository Git workflows](docs/how-to/run-repository-workflows.md)
for local usage, GitHub Actions and Bitbucket Pipelines examples, and recovery.

## Other entry points

- `init --directory <dir> --profile <name> --owner <id>` returns the
  initialized directory. Add `entries` to list its top-level contents; prefer
  `init-changes ... export --path <dir>` to apply changes to disk, including
  scaffold deletions. Add `--git` to commit changes and export a Git bundle.
- `update --directory <dir> --profile <name>` applies every capability's update
  policy.
  Node update replaces the whole `.npmrc` and `.nvmrc`, removes Forge package
  `engines`, and preserves `@types/node`. On `forge-app`, manifest update then
  derives the runtime from `.nvmrc`; review the result before exporting it.
  Add `--git` to commit changes and export a Git bundle.
- `validate --directory <dir> --profile <name>` returns a read-only capability
  report. Node validation uses fnm in a container to select the version requested
  by `.nvmrc`, potentially downloading Node; it is not a baseline-compliance or
  Forge-deployability check. Forge manifest validation separately runs pinned
  `forge lint` against the supplied repository, including source checks,
  without fixes.
  Supply dependencies needed by lint; no app registration or deployment occurs.
  Forge lint requires explicit `--forge-email` and `--forge-api-token` Dagger
  Secret inputs; omitted credentials report a prerequisite failure.
- These four verbs (`init`, `init-changes`, `update`, `validate`) are the whole
  interface. Standalone `copy-*`, `validate-*`, `remove-scaffold*`,
  `node-container`, and `export` functions have been removed: use `init` for
  first-time seeding (it runs the scaffold cleanup in
  [`src/composition/scaffold.ts`](src/composition/scaffold.ts)), `update` for maintenance, `validate`
  for every capability's report, and Dagger's own `export --path` on the
  returned directory or changeset.

Run `dagger call -m github.com/ibuchanan/ranch-rig-drop-calf --help` to list
every function, and add `--help` after a function name for its arguments.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, tests, code layout, and
how to change profiles or refresh the pinned templates. The
[specifications](specs/00-drop-calf-overview.md) describe the intended design;
they include features not yet present in the module.

## License

This repository and generated OSS projects use [Apache License 2.0](LICENSE).
