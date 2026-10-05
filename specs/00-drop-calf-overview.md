# Drop Calf specification

## 1. Purpose

`drop-calf` is a Dagger module that bootstraps and maintains software repositories. It treats a generated repository as the convergence of a **project profile** and a set of **capabilities**, rather than as a fixed template.

A human declares intent by choosing a profile (e.g., `library`, `forge-app`, `tool`, `agent-skill`). Each profile assembles the same capability slots, but each slot may be fulfilled by a different implementation. The module generates new projects and can later converge existing projects back to the current profile.

## 2. Goals

- Produce consistent, working repositories for common project kinds.
- Keep the generated developer API stable (`npm run lint`, `npm run format`, `npm run typecheck`, `npm run test`) while allowing implementation to vary by profile.
- Support idempotent updates to existing repositories.
- Avoid projen-style file ownership; merge into shared files where possible.
- Remain testable without the Dagger engine for the core abstraction.

## 3. Non-goals

- Replace project-specific scaffolding tools such as `forge create` or `npm init`. `drop-calf` composes on top of them.
- Track persistent state inside Dagger. State lives in Git and in the repository files themselves.
- Enforce a single toolchain across all project kinds. Profiles may choose different tools.

## 4. Core concepts

| Term | Definition |
|---|---|
| **Profile** | A named bundle of capabilities that defines what a project kind should look like. Examples: `library`, `forge-app`, `tool`, `agent-skill`. |
| **Capability** | An adapter that contributes one developer-facing concern to a project: linting, formatting, type checking, or testing. |
| **Capability slot** | A role in a profile, such as `linting`, `formatting`, `typechecking`, `testing`. A profile always has the same slots, but implementations vary and slots may be no-ops. |
| **ProjectBlueprint** | A pure TypeScript model of a project: a `package.json` object plus a map of file paths to contents. |
| **Seam** | The boundary between the pure blueprint manipulation and the Dagger `Directory` rendering. |

## 5. Capability interface

Every capability exposes a single operation:

```ts
type Capability = {
  addTo(project: ProjectBlueprint): void;
};
```

Capabilities must be **idempotent**. Applying the same capability twice to the same blueprint should produce the same result as applying it once.

Capabilities must **merge** rather than own shared files:
- Own specific `package.json` script keys.
- Own specific generated config files (`biome.json`, `tsconfig.json`).
- Merge into line-set or section-map files (`.gitignore`, `.editorconfig`).
- Merge block-delimited sections (`README.md`).

## 6. Developer API (package.json scripts)

Every non-empty capability slot contributes to the stable developer API. The exact command may vary by profile.

| Slot | Script(s) | Example implementations |
|---|---|---|
| Linting | `lint`, `lint:fix` (optional) | `biome lint`, `forge lint` |
| Formatting | `format`, `format:check` | `biome format --write`, `biome format` |
| Type checking | `typecheck` | `tsc --noEmit` |
| Testing | `test` | `bun test`, `vitest run`, or absent |
| Build | `build` | `tsc` |
| Clean | `clean` | `rm -rf dist` |

## 7. Profiles

Profiles are defined in `src/profiles.ts` as arrays of capabilities.

### 7.1 Initial profiles

| Profile | Linting | Formatting | Type checking | Testing |
|---|---|---|---|---|
| `library` | biome | biome | tsc | bun test |
| `forge-app` | forge lint | biome | forge-pinned tsc | bun test |
| `tool` | biome | biome | tsc | bun test |
| `agent-skill` | biome | biome | tsc | no testing |

### 7.2 Future profiles

Additional profiles may be added without changing existing capability implementations, provided the new profile uses the same capability interface.

## 8. Merge strategies by file kind

| File kind | Merge model | Implementation approach |
|---|---|---|
| `.gitignore`, `.dockerignore` | Line set | Normalize, union, deduplicate, sort. Preserve comments. |
| `.editorconfig`, INI files | Section map | Parse into `Map<section, Map<key, value>>`, merge per section, serialize. |
| `README.md` | Block markers | Wrap generated sections in `<!-- drop-calf:<slot> start/end -->` markers; replace only the marked block. |
| `package.json` | Key ownership | Capabilities own specific script and dependency keys; leave unrelated keys alone. |
| Owned config files (`biome.json`, `tsconfig.json`) | Full ownership | Regenerate entirely; mark as generated if appropriate. |
| Complex workflows | Full ownership | Replace the whole file; warn that hand edits will be overwritten. |

## 9. New project generation

The Dagger function `files(profile, packageName, description, license, author)`:

1. Creates a base `ProjectBlueprint` with minimal package metadata, base config files, `.gitignore`, `.editorconfig`, and `README.md`.
2. Looks up the requested profile.
3. Applies each capability in profile order.
4. Renders the blueprint to a Dagger `Directory`.

## 10. Existing project synchronization

A future `sync` Dagger function will:

1. Read an existing directory into a `ProjectBlueprint` by parsing existing files.
2. Apply the requested profile.
3. Render the result back to a `Directory`.
4. The caller reviews the diff with Git and commits.

This makes `drop-calf` a configuration convergence tool, not just a one-time generator.

## 11. Example-driven canonicalization

Profiles may be derived from existing example repositories:

1. Extract a `ProjectBlueprint` from each example repo.
2. Canonicalize the set of blueprints into a profile (common scripts, dependencies, config files).
3. Human reviews and curates the derived profile.
4. The profile is committed and used for generation and synchronization.

This is an optional workflow, not a requirement for the initial implementation.

## 12. Testing strategy

- Unit tests target pure blueprint manipulation and capability adapters. No Dagger engine required.
- Tests verify invariants (e.g., `.gitignore` contains an entry, `package.json` has a script) and merge behavior (e.g., existing entries are preserved).
- Snapshot tests document the expected output of merge functions and full profile generation.
- Dagger-level tests verify that `files()` returns a `Directory` containing expected entries.

## 13. Dagger's role

Dagger provides the runtime seam for:
- Reading existing directories (`dag.host().directory(...)`).
- Rendering generated directories.
- Running containerized tools when needed (e.g., `biome init`, `npm install`, test suites).
- Caching expensive operations.

Dagger does **not** track persistent project state. State lives in Git and in the repository files.

## 14. Open questions and future work

- How should the README reflect the chosen test runner and other capabilities? Currently the base README is static.
- Should profile selection support a default based on project metadata, or only explicit selection?
- Should `sync` support partial convergence (only certain capability slots)?
- How are example repositories pinned and versioned for canonicalization?
