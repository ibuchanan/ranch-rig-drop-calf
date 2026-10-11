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
dagger call files --help
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
dagger call files --profile library entries
```

The CLI loads the module from `dagger.json` and may generate a local `sdk/`
directory (ignored by Biome). `tsconfig.json` resolves `@dagger.io/dagger`
through that generated SDK, so if type checking reports a missing
`sdk/index.ts`, load the module with `dagger call files --help` before retrying.

The end-to-end test runs a real `forge create`, which registers an app in your
developer space, so it is opt-in:

```bash
DROP_CALF_E2E=1 bun test tests/e2e
```

## Code layout

- `src/index.ts`: Dagger `DropCalf` entry point; `files` builds a `Directory`
  and `export` writes a supplied `Directory` to a path.
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
- `src/templates.ts`: `copyTemplate`, the shared overlay used by every
  `templates/` tree.
- `src/changelog.ts`: the release workflow — the `git-cliff` devDependency and
  the `changelog` script, plus `copyChangelog` for
  `templates/changelog/`. `validateChangelog` renders an unreleased changelog
  in a container built from the Node baseline image, so the verdict depends on
  the policy under review rather than on whatever the host has installed.
- `src/typescript.ts`: the TypeScript toolchain — the `typescript`
  devDependency, the `typecheck` and `build` scripts that invoke `tsc`, and
  `copyTypeScript` for `templates/typescript/`, the one config
  every kind receives verbatim. Nothing else sets the compiler or calls it.
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
  and configuration to the blueprint. `docsLinting()` adds the `lint:docs`
  script and the `cspell`/`markdownlint-cli2` devDependencies every kind gets;
  the config those tools read stays pinned in `templates/docs`.
- `src/node.ts`: the Node baseline. `nodeBaseline()` seeds `.nvmrc`, `.npmrc`,
  `engines.node`, and `@types/node`; it never writes a manifest.
  `nodeContainer()` is the native Dagger side of
  the same baseline: the one place the Node image is chosen, so containerized
  tools (such as `validateChangelog`) run the pinned major rather than whatever
  the host has installed.
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

The current generator does not read or merge an existing repository; the only
step that reads one is `remove-scaffold`. Generated
projects have scripts and configs but no source tree, and the copied OSS README
is an unfilled template. The `agent-skill` profile intentionally omits a test
script. Use the specs as a roadmap, not as a description of current CLI behavior.

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
generates.

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

`validateChangelog` is the one function here that reads a repository rather than
the module source, so it needs a `Directory`, not a path, and it runs
git-cliff inside a container at the version `changelogToolchain` pins. That
means it needs a live engine, which is why its tests fake `dag.container()`
rather than starting one.

A capability cannot read the module source — that would break the pure blueprint
layer the Bun tests rely on. So content that belongs to a function but is
authored rather than derived is pinned in `templates/` and read at the Dagger
boundary, exactly like `oss` and `gitignore`.

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
