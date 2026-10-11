# Developing Drop Calf

Drop Calf (`drop-calf`) is a TypeScript Dagger module. The current code only
generates new project files, and
`remove-scaffold` strips a `forge create` starter first; the
[`specs/` documents](specs/00-drop-calf-overview.md) also describe future
synchronization and additional project functions.

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
shell. The `vendor/init-repo` Git submodule is a design reference, not a runtime
dependency. If you need to consult it, initialize it separately with
`git submodule update --init vendor/init-repo`.

## Development loop

```bash
bun run test
bun run typecheck
bun run lint
bun run format:check
```

`bun run format` and `bun run lint:fix` modify files. The test suite in
`tests/repo-init.test.ts` exercises the blueprint and capability logic without
starting Dagger. To exercise the Dagger boundary without writing generated
files locally:

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

To verify `init-changes` exports from empty directories across all profiles
and presets without registering or deploying a Forge app:

```bash
DROP_CALF_INIT_E2E=1 bun test tests/e2e/init.e2e.test.ts
```

The Forge end-to-end test runs a real `forge create`, which registers an app
in your developer space, so it is opt-in:

```bash
DROP_CALF_E2E=1 bun test tests/e2e
```

## Code layout

- `src/index.ts`: Dagger `DropCalf` entry point; `init` initializes an empty
  directory or a scaffold, and `init-changes` returns the changeset to export.
  `export` writes a supplied `Directory` to a path.
- `src/project.ts`: project blueprint, base package metadata and files,
  and Dagger directory rendering.
- `src/oss.ts`: owns the fixed Apache-2.0 `license` field, written into the
  blueprint by `ossLicense()`; and
  copies pinned `vendor/oss-templates` assets (see
  [Refreshing the pinned OSS templates](#refreshing-the-pinned-oss-templates))
  with only the documented owner,
  project name, and LICENSE year substitutions.
- `src/docs.ts`: copies `templates/docs/` through Dagger, separate from OSS.
  The tree carries the generated `docs/` placeholders plus the pinned
  `.cspell.jsonc` and `.markdownlint-cli2.jsonc` the `docsLinting()`
  capability runs. Both are dotfiles, so they are worth knowing about when
  extending the tree: Dagger's `glob` does match them, but a shell glob will
  not.
- `src/templates.ts`: `copyTemplate`, the shared tree overlay, and
  `seedTemplates`, which reads the template paths selected by capabilities and
  preserves SecretSpec substitutions and helper permissions.
- `src/changelog.ts`: the release workflow — the `git-cliff` devDependency and
  the `changelog` script, plus `copyChangelog` for
  `templates/changelog/`. `validateChangelog` renders an unreleased changelog
  in a container built from the Node baseline image, so the verdict depends on
  the policy under review rather than on whatever the host has installed.
- `src/typescript.ts`: the TypeScript toolchain — the `typescript`
  devDependency, the `typecheck` and `build` scripts that invoke `tsc`, and
  `copyTypeScript` for `templates/typescript/`, the one config
  every kind receives verbatim. Nothing else sets the compiler or calls it.
- `src/evals.ts`: optional Promptfoo toolchain — the `promptfoo` devDependency
  and `eval`/`view` scripts. It declares `templates/promptfoo/`, which holds
  the config, shared prompt, cases, synthetic contexts, and Rovo wiring guide;
  the blueprint does not author those seed files.
- `src/size-limit.ts`: the bundle-size budget — the `size-limit` and
  `@size-limit/file` devDependencies, the `size` script, and the named
  `size-limit` section of `package.json`. `size-limit` reads its budgets from
  `package.json` rather than a config file, so the capability owns the section
  outright and there is no template to seed. `SIZE_LIMIT_FIELD` keeps the field
  name in one place.
- `src/git-hooks.ts`: the Git hook workflow — the `lefthook` devDependency,
  the `prepare`/`lint`/`check` scripts, and `copyGitHooks` for
  `templates/git-hooks/lefthook.yml`. One config serves every kind: the
  scripts a kind omits are reached through `npm run <script> --if-present`, so
  a hook with nothing to run is a no-op rather than a failure.
- `src/prelint.ts`: the Forge prelint workflow — the `@ast-grep/cli` and
  `@forge-ahead/prelint` devDependencies, the `lint:prelint`/`lint:forge`
  scripts and the `lint` chain, plus `validatePrelint`, which installs the
  pinned rules in a container and scans a repository without changing it. The
  rules ship inside the package, so there is no config to seed.
- `src/secrets.ts`: the SecretSpec workflow — the `forge:*` scripts and
  `copySecretsAssets` for `templates/secretspec/`. The TOML and
  the two helpers are authored content copied for `forge-app`
  only, with just the project name substituted. `FORGE_SITE` is required,
  `env-var.sh` runs each command through `secretspec` with a recorded reason,
  and the app-variable helper pushes only its `APP_VARIABLE_KEYS` allowlist.
- `src/gitignore.ts`: assembles `.gitignore` from the pinned gitignore.io
  response, de-duplicating rules on first occurrence and appending the personal
  defaults. `copyGitignoreAssets` is the Dagger boundary used by generation and
  by `copy-gitignore`.
- `src/capabilities.ts`: adapters that add scripts, development dependencies,
  and configuration to the blueprint. A capability's optional `templates`
  array names zero or more module-source trees; `buildProject` collects those
  paths in `ProjectBlueprint.templates` without reading the files.
  `docsLinting()` declares `templates/docs` beside the `lint:docs` script and
  the `cspell`/`markdownlint-cli2` devDependencies every kind gets.
- `src/node.ts`: the Node baseline. `nodeBaseline(kind)` seeds `.nvmrc`, `.npmrc`,
  and `@types/node`; the dependency is init-only. `updateNode()` owns the whole
  `.nvmrc` and `.npmrc` files in every kind, including replacing owner-added
  scoped registries and auth settings. Forge updates remove the entire `engines`
  field; other kinds preserve owner engine declarations. No kind generates
  `engines`: it has caused trouble with `forge deploy`, and a development
  toolchain baseline is not a library's minimum supported runtime.
  `reconcileForgeRuntime()` enforces an existing Forge manifest's runtime name,
  preserving comments, key order, scalar styles, indentation, and siblings.
  Matching values preserve the original bytes; different values are replaced.
  Invalid YAML raises `ParseError`. `applyForgeRuntime()` leaves other kinds
  and absent manifests alone; neither init nor update creates a manifest.
  `validateNode()` copies only `.nvmrc` into an isolated Dagger container with
  pinned fnm, initializes its shell, and runs `fnm use --install-if-missing`.
  Missing `.nvmrc` is skipped; selectable non-baseline versions pass. The
  validator may download Node and does not check `.npmrc`, type versions,
  manifest acceptance, or deployment. Execution failures retain fnm's stderr
  in the read-only report. It never changes the host or exports
  container changes. `nodeContainer()` selects the baseline image for tools
  such as `validateChangelog`, independently of the host's Node installation.
- `src/profiles.ts`: ordered capability lists for the four supported profiles.
- `tests/repo-init.test.ts`: Bun unit tests for the pure blueprint/capability
  layer.
- `specs/`: design targets; check implementation before documenting any item
  as shipped.

To change generated output, edit the base blueprint or capability in `src/`,
then wire the capability into the intended profile(s) in `src/profiles.ts`. Add
a focused test of the resulting blueprint and run the checks above.
`renderToDirectory` is the Dagger boundary; keep ordinary project assembly
testable without the engine.

First-time `init` accepts either an empty directory or a scaffold. Its package
name is the explicit `--package-name`, then the nonblank scaffold name, then
the Dagger workspace directory name. Without a scaffold, cleanup and manifest
normalization do nothing. With a scaffold, `init` reads
and cleans a scaffold, merges its package dependencies, and normalizes an existing
Forge manifest runtime; synchronization of established projects is not implemented.
`DROP_CALF_NODE_E2E=1 bun test tests/e2e/node.e2e.test.ts` verifies runtime
normalization through a real Dagger init without registering or deploying an app.
Generated projects have scripts and configs but no source tree, and the copied
OSS README is an unfilled template. The `agent-skill` profile intentionally omits
a test script. Use the specs as a roadmap, not as a description of current CLI
behavior.

## Seeded assets

`.gitignore` is a seeded asset, not a blueprint file: like the OSS and docs
trees, it is pinned outside `ProjectBlueprint` and copied into the rendered
`Directory` by `copyGitignore`. That keeps assembly pure and testable, and means
`buildProject` does not produce `.gitignore` — a unit test asserting on generated
`.gitignore` content should assert on `buildGitignore` instead.

The same applies to the TypeScript configs. `templates/typescript/` holds the
two files copied verbatim from
`vendor/explore-forge-jira-remote-data-fields`, and every kind seeds them, so no
capability writes a `tsconfig` and `buildProject` carries none for any profile.
Assert on
`templates/typescript` rather than on the blueprint when testing what a kind
generates. For `forge-app`, the later `templates/vitest` tree replaces only
`tsconfig.typecheck.json`; the deploy-time `tsconfig.json` remains shared.

Forge runs on Node, not Bun. Vitest matches that runtime, provides `vi.mock` for
`@forge/*` modules, and matches the vendored Forge examples and architecture
tests. `library` and `tool` keep Bun's runner; `agent-skill` has no test scripts.
Both Vitest packages are pinned together through `TOOL_VERSIONS.vitest`.

The Vitest config starts from the OKF producer example's discovery exclusions.
It deliberately uses explicit imports instead of globals so app code does not
acquire implicit test APIs. The current prelint rule
`manifest-tests-use-vitest-globals` warns about this deliberate choice; explicit
imports are supported by Vitest and the integration tests verify them.
The typecheck overlay includes tests and the Vitest
config, with modern module resolution confined to local checks. Tests and test
config stay outside the Forge handler build. The existing pre-push lint group
includes `typecheck`, so broken tests block pushing as broken source does.

`DROP_CALF_TESTING_E2E=1 bun test tests/e2e/testing.e2e.test.ts` verifies real
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

`validateChangelog` reads a repository rather than
the module source, so it needs a `Directory`, not a path, and it runs
git-cliff inside a container at the version `changelogToolchain` pins. That
means it needs a live engine, which is why its tests fake `dag.container()`
rather than starting one.

A capability cannot read the module source — that would break the pure blueprint
layer the Bun tests rely on. It declares template paths as data instead.
`init` seeds those selected trees through `seedTemplates`, with no profile
checks in the seeding entry point. Changelog templates belong to
`changelogToolchain()`, and SecretSpec templates belong to `forgeSecrets()`.
OSS and gitignore remain base assets rather than optional capabilities.

The standalone `copy-docs`, `copy-typescript`, `copy-changelog`, `copy-git-hooks`,
`copy-secrets`, and `copy-biome` Dagger functions remain available for deliberate
re-seeding of one tree in an existing repository without generating a package or
selecting a whole profile. They are not steps in the `init` pipeline.

Every kind's `biomeToolchain()` declares `templates/biome`. Generation seeds its
`biome.jsonc` verbatim, without invoking a local Biome binary or creating a
host temporary directory. The template's `$schema` must match
`TOOL_VERSIONS.biome`; the test suite checks for drift. Edit the pinned template
to change the configuration rather than rebuilding it in code.

`templates/biome/.editorconfig` is the only EditorConfig source for generated
repositories. Both generation and standalone `copy-biome` seed it verbatim. The
seeded source survives rather than the generated text so editor settings remain
reviewable beside the formatter config, without a second definition or a seeding
exception. Only `[*]` defaults and the Markdown override remain; file-specific
sections that repeated those defaults were removed.

Markdown keeps trailing whitespace because two trailing spaces encode a hard
line break. The docs template leaves markdownlint's MD009 at its default, which
allows two-space hard breaks while rejecting other excess trailing whitespace.
Editors therefore preserve meaningful spaces, and `lint:docs` checks their use.

## The generated `.gitignore`

`src/gitignore.ts` assembles `.gitignore` from the gitignore.io templates in
`GITIGNORE_TEMPLATES` (`visualstudiocode`, `linux`, `macos`, `windows`,
`node`, and `turbo`), de-duplicating rules on first occurrence, then appends
`ADDITIONAL_IGNORES`: `.fallow/`, `.scratch/`, `.session/`, and
`/.cocoindex_code/`. `copy-gitignore --sets node,turbo` selects a subset by
gitignore.io name; the default is all of them, and an unknown name fails before
anything is written.

### Refreshing the pin

`vendor/gitignore` holds the gitignore.io response that `src/gitignore.ts`
assembles from, so generation never depends on the network. Refresh it
deliberately and read the diff, because upstream templates change without
notice:

```bash
bun run refresh:gitignore
```

Edit `GITIGNORE_TEMPLATES` in `src/gitignore.ts` to change which templates are
pinned, then refresh. Two things will bite you if you skip the script: the macOS
template contains a rule that only matches with its literal CR bytes, so an
editor that normalises line endings silently breaks it, and `.gitattributes` pins
the file to `-text` to stop Git doing the same. Tests read the real pin, so a
refresh that changes output shows up in the `kind-outputs` snapshot.

## Refreshing the pinned OSS templates

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
`src/oss.ts` does not list; add it there (and to `transformOssTemplate` if it
needs substitutions), then refresh.
