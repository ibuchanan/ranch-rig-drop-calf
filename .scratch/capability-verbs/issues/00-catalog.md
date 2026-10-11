# 00: Catalog — init, update, validate

**What to build:** The `catalog` capability initializes a single root `catalog-info.yaml` Component entity with seed tokens replaced by name, description, staff ID owner, and copyright year. Implement explicit verbs: init seeds from template, update is an explicit no-op, validate checks structural integrity.

**Today:** `catalog.ts` declares the file seed, an explicit update no-op with a reason, and structural validation. The module owns the whole file; no update policy is defined. The template has seed tokens for name, title, description, owner, type, and copyright date.

**Capability contract:**

- **init** seeds the file from `templates/catalog/catalog-info.yaml`, replacing seed tokens:
  - `[Catalog name]` → `metadata.name`: sanitized lowercase ASCII letters, digits, `.`, `_`, `-`; max 63 chars; alphanumeric start and end.
  - `[Project name]` → `metadata.title`: original project name, no sanitization.
  - `[Package name]` → annotation `forge-ranch/package-name`: original package name from npm scope/name.
  - `[Description]` → `metadata.description`: project description or empty.
  - `[Owner]` → `spec.owner`: `user:default/{staff-id}`, validated as entity reference format.
  - `[Project kind]` → `spec.type`: the selected profile kind (`library`, `forge-app`, `tool`, `agent-skill`).
  - `[Copyright date]` → annotation `forge-ranch/copyright-date`: YYYY or YYYY-YYYY (ordered range), captured once at init, never auto-incremented by update.
- **update** is an explicit no-op: "Catalog owns the file, but no update policy is defined."
- **validate** checks structural acceptance without policy compliance:
  - YAML syntax and duplicate-key detection via `parseDocument`.
  - Roadie schema validation via `@roadiehq/roadie-backstage-entity-validator`.
  - `kind` must be `Component`.
  - `spec.owner` must be a user entity reference: `user:{namespace}/{id}` or `user:{id}`; nested paths are invalid.
  - `forge-ranch/copyright-date` annotation (if present): must be YYYY or YYYY-YYYY with ordered range, no policy checks.
  - Missing catalog file → skipped with reason.

**Blocked by:** 02 (Expand — every capability has init, update and validate)

**Status:** implemented

- [x] init, update and validate are each implemented or a no-op with a reason that answers "why is there no …?".
- [x] The policy decisions are recorded in the spec sections (specs/02-project-functions.md catalog section).
- [x] Catalog capability is listed in kind compositions (specs/01-project-kinds.md, default order position).
- [x] Update is explicitly a no-op with documented reason (no seeding policy, no version bumping, no owner rewriting).
- [x] Validate checks structural shape only, not policy compliance or remote existence.
- [x] Existing snapshots are unchanged; catalog init, update no-op, standalone validation, editable seed, and malformed-input behavior have focused tests.

**Open decisions and future work:**

- Package metadata (04) and OSS (06) depend on this capability. Package-name and description wiring belongs to 04; OSS reads `metadata.title` for names, `forge-ranch/copyright-date` for LICENSE, and `spec.owner` for OWNER in 06. README stays init-only; OWNER becomes catalog-derived on init and update. The permanent shared-field contract is recorded in specs/02-project-functions.md, not only in these tickets.
- Annotations for Jira/GitHub links are documented as examples in template but not auto-populated (no discovery network calls).
- Catalog is standalone; consumer wiring (OSS field defaults, OWNER policy migration) deferred.

**Related:**

- [ADR 0001](../../../docs/adr/0001-capability-verbs-by-intent.md) — capability verbs model.
- [Specs 02 catalog section](../../../specs/02-project-functions.md#catalog) — catalog capability policy.
- [Specs 01 composition](../../../specs/01-project-kinds.md) — catalog in kind slot order.
- [Ticket 04](04-package-metadata.md) — package.json metadata verbs; interop blocked.
- [Ticket 06](06-oss.md) — OSS verbs; reads catalog copyright-date annotation on future update.
