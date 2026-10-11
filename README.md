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

**Status:** Early implementation.
Generation is available;
synchronization of existing repositories,
conflict-aware merging,
and the broader project functions in the [specifications](specs/00-drop-calf-overview.md)
are not implemented.

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
   are preserved. `src/` is never touched. This is first-time setup, not an
   update command.

3. Apply the same changes to the working tree, then install:

   ```bash
   dagger call -m github.com/ibuchanan/ranch-rig-drop-calf init-changes \
     --directory . --profile forge-app --owner your-staff-id export --path .
   npm install
   ```

4. Fill in the generated `README.md` and review `CONTRIBUTING.md`; both are
   templates.

Dagger uploads the directory you pass, including the `node_modules` that
`forge create` installed. Delete it first if the upload is slow.

Use `init-changes`, not `init ... export`: `init` returns a plain directory,
and Dagger's export merges by default, so the removed scaffold files would
stay on disk. Do not add `--wipe` in an existing repository; it also deletes
unrelated files.

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
- **Node baseline:** Node 24 in `.nvmrc`, `engines.node`, and `@types/node`,
  plus an `.npmrc` pinning the public npm registry, which is not the default
  inside Atlassian.
- **`.gitignore`:** assembled from pinned gitignore.io templates, so output is
  deterministic and generation works offline.

Common options:

- `--package-name` overrides the package name; `init-changes` defaults to the
  scaffold's.
- `--description` and `--author` set package metadata.
- `--with-functions evals` or `--preset all` adds evaluation scripts on
  `forge-app`; `--without-functions evals` excludes them from `--preset all`.
- `--without-functions aidev` omits the `AGENTS.md` guidance seed.

Core profile capabilities cannot be removed.

## Other entry points

- `files --profile <name> --owner <id>` generates a profile's files without a
  scaffold, for a repository that `forge create` did not start. Add `entries`
  to list them, or `export --path <dir>` to write them; exporting over an
  existing repository replaces files with the same names.
- `remove-scaffold-changes --directory .` is the cleanup step of
  `init-changes` on its own. It deletes the fixed list in
  [`src/preclean.ts`](src/preclean.ts) without backups.
- `copy-*` functions copy one asset set (docs, TypeScript, OSS, changelog,
  `.gitignore`, and more), and `validate-changelog` and `validate-prelint`
  check an existing repository.

Run `dagger call -m github.com/ibuchanan/ranch-rig-drop-calf --help` to list
every function, and add `--help` after a function name for its arguments.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, tests, code layout, and
how to change profiles or refresh the pinned templates. The
[specifications](specs/00-drop-calf-overview.md) describe the intended design;
they include features not yet present in the module.

## License

This repository and generated OSS projects use [Apache License 2.0](LICENSE).
