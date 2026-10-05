# Developing Drop Calf

Drop Calf (`drop-calf`) is a TypeScript Dagger module. The current code only
generates new project files; the
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
dagger call files --profile library --package-name example-lib entries
```

The CLI loads the module from `dagger.json` and may generate a local `sdk/`
directory (ignored by Biome). `tsconfig.json` resolves `@dagger.io/dagger`
through that generated SDK, so if type checking reports a missing
`sdk/index.ts`, load the module with `dagger call files --help` before retrying.

## Code layout

- `src/index.ts`: Dagger `DropCalf` entry point; `files` builds a `Directory`
  and `export` writes a supplied `Directory` to a path.
- `src/project.ts`: project blueprint, base package metadata and files,
  license text, and Dagger directory rendering.
- `src/capabilities.ts`: adapters that add scripts, development dependencies,
  and configuration to the blueprint.
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

The current generator does not read or merge an existing repository. Generated
projects have scripts and configs but no source tree, and the generated README
is generic. The `agent-skill` profile intentionally omits a test script. Use
the specs as a roadmap, not as a description of current CLI behavior.
