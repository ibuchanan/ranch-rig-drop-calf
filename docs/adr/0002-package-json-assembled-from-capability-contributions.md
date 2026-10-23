# ADR 0002: package.json is assembled from capability contributions

- **Status:** Proposed
- **Date:** 2026-10-12

## Context

Every capability that touched `package.json` carried its own copy of the same
read, shape-check, merge, sort, and write sequence, and most stated the same
scripts and dependencies twice: once in `init` and again in `update`. The file
is a single coherent document, but no module owned it.

## Decision

A `package-json` module owns `package.json`. Capabilities do not edit it
directly; each declares a contribution of **seed** and **policy** entries (see
`GLOSSARY.md`), computed from the capability's own options when it is built.
- `init` creates the file from a template, or cleans and merges into the
  `forge create` scaffold (the module owns that cleanup), then applies every
  selected capability's seed and policy, so a freshly initialized repository
  shows its full intended state.
- `update` applies every policy entry, then freshness, before capability
  `update` verbs run.
- Scripts are typically policy. Dependencies are seed; freshness keeps seeded
  dependencies from falling behind Drop Calf's pins, deterministically and
  without downgrading owner choices.
- Two capabilities contributing the same key is an error. Collisions are
  expected; resolution rules will be designed from the real cases found.
- Rules that depend on repository contents, such as the license derived from
  the catalog, stay in the owning capability's `update` and use the module's
  low-level edit primitive.
- Capability verbs act only on files the capability owns; `package.json` is
  contributed. A capability whose only output is its contribution declares
  `update`, and `init` when it seeds no files, as a no-op whose reason
  describes the contribution.

Pins live in `pins/package.json`, a private manifest that is never installed.
Its `devDependencies` list every npm-installable pin as an exact version, so
standard tooling (Dependabot, `npm-check-updates`) can report stale pins while
applying them stays deterministic. Freshness skips entries it cannot compare,
such as GitHub references. Pins that are not npm packages, such as the Bun
image or Node major, stay in code.

This refines ADR 0001 rather than replacing it: each capability still decides
which lifecycle its outputs follow, and the module only applies that decision.
It is a file-format helper, not the generic convergence engine ADR 0001
rejected.

## Alternatives considered

### A helper called from each capability's verbs

Removes the duplicated I/O but leaves no owner for the file, so collisions and
the init-superset-of-policy guarantee cannot be checked in one place.

### Init seeds only what update does not enforce

States each value once, but a freshly initialized repository would no longer
show its full intended state to a human reading the blueprint.

### Dependencies as policy

Keeps tools pinned exactly, but downgrades owners who deliberately moved ahead
and re-adds dependencies they removed.
