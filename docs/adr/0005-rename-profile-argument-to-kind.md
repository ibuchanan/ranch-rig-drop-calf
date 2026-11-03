# ADR 0005: Rename the Dagger `profile` argument to `kind`

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

Drop Calf's public Dagger functions `init`, `init-changes`, `update`, and
`validate` each take a required `profile` argument that selects the project
kind (`library`, `forge-app`, `tool`, `agent-skill`).

Under Dagger `v1.0.0-beta.23`, every call to these functions fails before any
module code runs:

```text
flag already exists: profile
```

Evidence gathered while migrating from Dagger 0.21:
- The failure happens with and without `--profile` on the command line, and with
  any subcommand after the function (`entries`, `export`). `--help` works.
- The CLI treats `profile` as a known flag name. `dagger --profile x version`
  reports `flag --profile is not supported by command "dagger"`, while an
  invented flag reports `unknown flag`.
- Renaming only the argument in the generated `entrypoint/main.dang` typedef
  makes argument parsing succeed, so the argument name is the sole cause.
- The module defines no constructor arguments and no duplicate `profile`
  arguments.
- Upstream tracks the same class of failure for an argument named `workspace`
  ([dagger/dagger#13352](https://github.com/dagger/dagger/issues/13352), open)
  and the general flag-namespace conflict in
  [dagger/dagger#7032](https://github.com/dagger/dagger/issues/7032).

The Dagger CLI offers no way to register both the old and the new name, because
the old name fails at parse time.

## Decision

Rename the Dagger-facing argument `profile` to `kind` on `init`, `initChanges`,
`update`, and `validate`. The CLI flag becomes `--kind`.

The rename is limited to the Dagger boundary:
- The internal concept stays "profile": `src/composition/profiles.ts`, the
  glossary, and the capability-composition code keep their names.
- Accepted values and the output contract are unchanged.
- `--kind` and `--project-kind` were both free on the root command in
  beta.23; `kind` matches `specs/01-project-kinds.md` and the existing error
  wording ("Select a project kind").

## Consequences

- This is a breaking change to the public input contract. There is no
  deprecated alias, because the old name cannot be registered.
- Callers must change `--profile` to `--kind`: `README.md`, `DEVELOPMENT.md`,
  the how-to guides, generated documentation and CI snippets, and any external
  scripts.
- Argument error messages that mention `--profile` must say `--kind`.
- If a later Dagger release stops reserving `profile`, the rename can be
  reverted. It should not be reverted silently, because callers will have moved.
- Other argument names may become reserved in later betas. The check is to
  probe the name with `dagger --NAME x version` and look for "not supported".

## Alternatives considered

- **Keep `profile` and wait for a fix.** Preserves the contract but leaves
  Drop Calf unusable on Dagger 1.0 betas.
- **Separate flags from function arguments with `--`.** Floated in #7032 but not
  confirmed as shipped, and it would burden every caller.
- **`project-kind` or `type`.** Also free in beta.23. `kind` is shortest and
  matches the specs.
