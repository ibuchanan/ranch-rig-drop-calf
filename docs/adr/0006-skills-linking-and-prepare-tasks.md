# ADR 0006: Skills linking is separate from skill authoring

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

Only `forge-app` uses skill-linking workflows. `agent-skill` needs skill-authoring
scripts. Linking must join `prepare` without competing with Git hooks for script
ownership or hiding failures behind hook-install tolerance.

## Decision

- Select a file-free `skills` capability for `forge-app` only. It seeds
  `agent-skills-toolkit` and `skill-wrangler` as dev dependencies and contributes
  `skill:link-wrangler: link-skills --package skill-wrangler` as policy.
- Keep `skill-toolkit` for `agent-skill` authoring scripts only; it retains
  dependency seeds and authoring scripts without competing with `skills`.
- Git-hooks for `forge-app` keeps ownership of `prepare` and contributes
  `prepare:hooks` for `lefthook install || true`. Its aggregate uses `run-s`
  from the existing lint-owned `npm-run-all2` dependency with npm.
- `forge-app` preparation runs `prepare:hooks` then the quoted `skill:link-*`
  wildcard. Only hook installation is failure-tolerant; skill-link failures
  fail preparation. Libraries retain build-before-hooks without skill linking.
- Additional owner-authored `skill:link-*` scripts join automatically. Capability
  init/update never executes linking, hooks, builds, or dependency installation.
- Other project kinds (`library`, `tool`, `agent-skill`) retain existing `prepare`
  workflows without skills capability and without `run-s` composition.

## Consequences

The new skills-linking workflow and wrangler dependency appear only in `forge-app`. The `agent-skill`
composition remains unchanged: `skill-toolkit` owns authoring scripts and tooling
dependencies. No skill content is copied into Drop Calf or its templates. Dependencies
remain seeds and Git references remain owner-managed on update, as in ADR 0002;
adopting `forge-app` with skills into an existing repository requires installing
its new seeds.
