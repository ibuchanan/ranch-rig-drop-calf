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

## Try it

From a target repository,
with the [Dagger CLI](https://docs.dagger.io/install/)
and a working Dagger engine installed, call the hosted module:

```bash
cd /path/to/target-repo
dagger call -m github.com/ibuchanan/ranch-rig-drop-calf files --profile forge-app --owner your-staff-id entries
```

Dagger fetches the module from GitHub, so you do not need a local checkout of
Drop Calf. This lists the generated files, including `package.json`, `README.md`,
`tsconfig.json`, `.gitignore`, and `.editorconfig`. The command inspects a
Dagger `Directory`; it does not write the files to your working tree. Run
`dagger call -m github.com/ibuchanan/ranch-rig-drop-calf files --help` for the
available arguments and directory operations.

The generated package name defaults to the target directory name; set
`--package-name` to override it. `entries` only lists files. To write them,
replace `entries` with `export --path /path/to/preview` and review the output
before exporting into an existing repository: files with the same names can be
replaced.

The available profiles are `library`, `forge-app`, `tool`, and `agent-skill`;
`--profile` is required. On `forge-app`, `--with-functions evals` or
`--preset all` enables evaluation scripts; `--without-functions evals`
excludes them from `--preset all`. Core kind slots cannot be removed.
Pass `--description` and `--author` to customize package metadata. OSS output
uses the pinned [`vendor/oss-templates`](vendor/oss-templates) Bitbucket
submodule: `LICENSE`, `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`,
`SECURITY.md`, and `.atlassian/OWNER` are copied from that source. Pass your
Atlassian staff ID via required `--owner`: it replaces the OWNER
placeholder. The project name replaces `[Project name]` in README and
CONTRIBUTING; the current year replaces `[YYYY]` in LICENSE. The license is
fixed to Apache-2.0. Review remaining template guidance before publishing.

The generated output is a starter configuration, **not a complete runnable
application**: it does not include source files or install dependencies. Its
copied README is a placeholder template and must be completed before use.
Unknown or ambiguous profile names fail before generation.

## Contributing

See [DEVELOPMENT.md](DEVELOPMENT.md) for local setup, tests, code layout, and
how to change profiles. The [specifications](specs/00-drop-calf-overview.md)
describe the intended design; they include features not yet present in the
module.

## License

This repository and generated OSS projects use [Apache License 2.0](LICENSE).
