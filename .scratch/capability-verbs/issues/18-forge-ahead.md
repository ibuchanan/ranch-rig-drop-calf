# 18: Forge Ahead dependencies — init, update, validate

**What to build:** The three `@forge-ahead/*` runtime dependencies in a Forge
app have deliberate verbs.

**Previous behavior:** generation replaced the whole `dependencies` object, so
only the scaffold merge kept a scaffold's own runtime dependencies.

**Agreed policy:**

- `@forge-ahead/errors` and `@forge-ahead/logging` are authoritative. Update owns
  only these two runtime dependency keys and enforces their `TOOL_VERSIONS`
  references, even when the owner selected a newer version or alternate Git
  reference. No version comparison or conflict detection runs.
- `@forge-ahead/atlassian-api-types` is an init-only convenience seed for new Forge
  apps. Not every app calls product APIs. Update preserves owner replacements
  and deletions and never adds this dependency to an existing app.
- Init therefore is implemented, not a no-op: it merges only the API-types seed
  into blueprint dependencies. Errors and logging arrive through top-level
  init's final update pass. Other runtime dependencies survive both verbs without
  relying on scaffold merging. The legacy `addTo` contribution also merges keys.
- Validate is an explicit no-op: "Forge Ahead dependencies have no repository-local
  configuration to validate; comparing dependency references would check policy,
  not tool acceptance. Runtime integration belongs to the app's build and test
  workflows."
- Update leaves a missing package absent, creates missing owned keys/sections,
  rejects malformed package JSON or a non-object dependencies section before
  writes, preserves unrelated package fields/files/lockfiles, and retains matching
  package bytes. No installs or lockfile refreshes run. Registry GitHub references
  currently have no commit/tag; authoritative strings are not immutable pins.

**Blocked by:** 02 (Expand — every capability has init, update and validate)

**Status:** implemented

- [x] init, update and validate are each implemented or a no-op with a reason that answers "why is there no …?".
- [x] Each policy question is answered and recorded in the module's spec section.
- [x] Other runtime dependencies survive both init and update, without relying on the scaffold merge.
- [x] Update is idempotent: a second run changes nothing.
- [x] Snapshots are reviewed as intentional: all 13 existing snapshots pass unchanged; fully initialized new-app output still includes all three dependencies.

**Verification:**

- `tests/forge-ahead.test.ts`: 20 focused cases covering isolated seed preservation,
  legacy preservation, authoritative replacements, API owner edits/deletions,
  missing sections/package, byte preservation, malformed input, read-only skipped
  validation, and top-level init/update for empty and scaffolded apps.
- `bun test`: 634 passed, 60 opt-in end-to-end tests skipped, 0 failed; 13 snapshots.
- `bun run typecheck`, `bun run lint`, `bun run format:check`, and
  `git diff --check` pass.

**Related:**

- [Project-functions specification](../../../specs/02-project-functions.md#forge-ahead)
- [ADR 0001](../../../docs/adr/0001-capability-verbs-by-intent.md)
