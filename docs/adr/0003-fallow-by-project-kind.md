# ADR 0003: Seed Fallow for tools and libraries

- **Status:** Accepted
- **Date:** 2026-10-13

## Context

Fallow analyzes unused code and dependencies, duplication, and complexity.
Tools and libraries have standard package entry points. Forge apps use
manifest handlers and frontend resources that need separate reachability
verification.

## Decision

Seed Fallow by default for `tool` and `library`, with
`--without-functions fallow` to opt out. The generated `lint:fallow` script
runs dead-code, duplication, and health analysis, failing on findings. Seed an
owner-managed `.fallowrc.jsonc` that excludes `git-cliff`: the changelog
script invokes its `git cliff` binary, which Fallow does not recognize as use
of the dependency.

Exclude `forge-app` (including `--preset all`) and `agent-skill`. Forge's
manifest handlers and frontend resources are nonstandard entry points; we
should establish reliable reachability before seeding a check that could
report false unused code. Agent skills are not a target of this adoption.

Update enforces the script and refreshes the seeded pin but does not restore
or overwrite the config. Capability validation skips source scanning with an
explicit reason; run `lint:fallow` in the project after installing dependencies.

## Alternatives considered

Making Fallow opt-in for tools and libraries would avoid a new default check,
but their conventional entry points make the check useful without
project-specific configuration. Enabling it for Forge now risks false
unused-code results; revisit that when Forge's entry points can be modeled
reliably.
