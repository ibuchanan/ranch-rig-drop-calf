# ADR 0004: Organize `src/` into core, composition, and capability subpackages

- **Status:** Accepted
- **Date:** 2026-10-14

## Context

`src/` is a flat directory of 33 modules. The decomposition inside it is already
sound: one module per capability, a pure `ProjectBlueprint`, and a
`renderToDirectory` seam at the Dagger edge. What the layout does not show is
that these modules play three different roles, so nothing prevents a future
change from wiring a capability into the machinery or the machinery into a
capability.

The modules fall into three groups by role:

- **Framework and shared machinery.** `capability.ts` (the contract),
  `project.ts` (blueprint and rendering seam), `templates.ts`,
  `package-json.ts` (contribution assembly), `tool-run.ts`, `versions.ts`, and
  `errors.ts`. None of these knows about a specific capability.
- **Composition.** `profiles.ts` selects capabilities per project kind and owns
  the scaffold-step table; `scaffold.ts` implements those steps for fresh
  `forge create` output.
- **Capabilities.** One module each, 23 in total, including `catalog.ts`, which
  is both a capability and the shared metadata source that `node`, `oss`, and
  `package-metadata` read.

The import graph is already acyclic and points at the machinery. The only
capability-to-capability edge is `EVALS_TEMPLATE`, a template path constant
imported from `evals.ts` by `docs.ts` and `aidev.ts`.

## Decision

Group `src/` into three subpackages by role, and state the dependency direction
they imply.

```
src/
├── index.ts                    # Dagger adapter: @object DropCalf, init/initChanges/update/validate
├── core/
│   ├── capability.ts
│   ├── project.ts
│   ├── templates.ts
│   ├── package-json.ts
│   ├── tool-run.ts
│   ├── repository.ts
│   ├── repository-git.ts
│   ├── versions.ts
│   └── errors.ts
├── composition/
│   ├── profiles.ts
│   └── scaffold.ts
└── capabilities/
    ├── catalog.ts
    └── … one module per capability
```

`src/index.ts` stays at its current path: Dagger's TypeScript entrypoint is
`src/index.ts`, so relocating it changes the module's public address.

Allowed imports, enforced by review:

| Subpackage | May import | Must not import |
|---|---|---|
| `core/` | other `core/` | `capabilities/`, `composition/`, `index.ts` |
| `capabilities/` | `core/`, and `catalog.ts` readers | any other capability, `composition/` |
| `composition/` | `core/`, all `capabilities/` | `index.ts` |
| `index.ts` | `core/`, `composition/` | (nothing imports it) |

Two rules are explicit rather than incidental:

- **`catalog.ts` is the one deliberate shared dependency between capabilities.**
  The functions specification already makes it the language-independent
  metadata source, read by `package-metadata`, `node`, and `oss`. Keeping it
  inside `capabilities/` at this size is acceptable; the rule records that
  reading it is intended, not an accident to be copied.
- **Capabilities do not depend on each other.** `EVALS_TEMPLATE` is a template
  path constant, not capability behavior, so it moves to `core/templates.ts`.
  After that extraction the rule holds exactly.

Repository Git workflows also belong in `core/`: `repository.ts` orchestrates
an injected directory transformation, and `repository-git.ts` owns the Git
transaction without naming capabilities or profiles. Their disposable-repository
tests live in `tests/core/`; the local launcher stays in `scripts/repository.ts`
and its container round-trip suite stays in `tests/e2e/`.

Tests and scripts follow the same shape. `tests/` gains `core/`,
`composition/`, and `capabilities/` siblings to `e2e/`, and its shared fixtures
(`capability-fixtures.ts`, `container-source.ts`, `module-source.ts`,
`oss-source.ts`, `templates-source.ts`) move to `tests/support/`. Import paths
in tests and `scripts/` are rewritten to the new locations; no re-export shims
are left at the old flat paths.

## Alternatives considered

### Two subpackages: `core/` and `capabilities/`

Leaves `profiles.ts` and `scaffold.ts` in the capability list, where they read
as two more plugins. Composition is the one place that knows every capability,
and that asymmetry is worth a directory.

### Grouping capabilities by project kind or by slot

A `capabilities/forge/` directory, or directories per capability slot
(`test/`, `lint/`, `build/`), would reduce the flat list. Both mislead. Project
kind is *data*: `PROFILES` selects capabilities, and the specifications are
explicit that kind membership is not baked into a capability. Slot folders
would assert a taxonomy the profile table already owns, and would require a
directory for each of roughly eleven slots holding about two files each.

### A `package.json` per subpackage (workspaces)

Drop Calf is one deliverable with one version, one Dagger entrypoint, and no
independent consumer of a subpackage. Workspaces would add release and build
ceremony without enabling anything.

### Barrel `index.ts` per subpackage

The repository uses explicit deep imports with `verbatimModuleSyntax`. A barrel
would hide exactly the edges the dependency rule is meant to keep visible.

### Leaving the layout flat and documenting the roles in prose

Rejected. `DEVELOPMENT.md` already describes the roles, and the flat listing
still invites the wrong import. Structure is the part of the documentation a
compiler and a reviewer can check.

## Consequences

- Moving a module now communicates its role, and a misplaced import is visible
  in the diff rather than only in review prose.
- The unit tests, the `tests/e2e/` suites, and 4 scripts import
  `../src/<module>.ts` and need mechanical path rewrites, as do the moved
  tests' `import.meta.dir` and `new URL(..., import.meta.url)` paths. The change
  lands with no compatibility shims, so no old path survives.
- `templates/` and `vendor/` stay at the repository root. Dagger reads them
  through `dag.currentModule().source()` and the specifications treat them as
  pinned assets outside `ProjectBlueprint`; coupling seeded assets to source
  layout would reverse that.
- `biome.jsonc` and `tsconfig.json` already cover everything under `src/` and
  need no change.
- This ADR records the target layout, which is now in place. `src/` holds
  `core/`, `composition/`, and `capabilities/`; `tests/` mirrors them with a
  `tests/support/` fixture directory; and `EVALS_TEMPLATE` lives in
  `core/templates.ts`, so no capability imports another.

## Related specifications

- [Overview and domain terms](../../specs/00-drop-calf-overview.md)
- [Project-function contract and policies](../../specs/02-project-functions.md)
- [ADR 0002: package.json assembled from capability contributions](0002-package-json-assembled-from-capability-contributions.md)
