# 04: Package metadata — init, update, validate

**What to build:** The base `package.json` metadata every kind gets has
deliberate verbs: `name`, `version`, `type`, `description`, `author`, and
`private` (from old ticket 06, a Forge app as a private package). `license`
belongs to OSS (ticket 06).

**Today:** every field is written at generation. On `init` the scaffold merge
lets generated keys win. `private` is never set, so a `forge-app` from an empty
directory could be published by accident.

**Policy questions to work through:**

- Which fields are init-only, because they're the owner's after creation (likely `name`, `version`, `description`, `author`)?
- Which are policy that update enforces (`type: module`? `private` on `forge-app`)?
- `private` per kind: `forge-app` true, `library` publishable, and a deliberate choice for `tool` and `agent-skill`.
- Is there anything to validate, or is validate a no-op? State why.

**Catalog dependency:** Consume the catalog capability introduced before this ticket.
`catalog-info.yaml` is the centralized, language-independent metadata source:
`metadata.title` is the display name, `metadata.name` is the catalog identifier,
`metadata.description` is the shared description, `spec.owner` is a user entity
reference, and `forge-ranch/package-name` preserves the package name. External
system pointers live in catalog annotations and links. Do not infer an npm name
from the sanitized catalog identifier. The catalog module owns its whole file;
package metadata reads it rather than writing it. Consumer wiring is deferred to
this ticket; decide which fields are derived on init and on update.

**Blocked by:** 02 (Expand — every capability has init, update and validate),
and the new catalog module (00-catalog).

**Status:** implemented

- [x] init, update and validate are each implemented or a no-op with a reason that answers "why is there no …?".
- [x] Each policy question is answered and recorded in the module's spec section.
- [x] Update is idempotent: a second run changes nothing. It's tested on a freshly initialised repository and on one with owner edits.
- [x] `forge-app` is private with and without a scaffold, including when a scaffold says `private: false`.
- [x] Snapshots are updated, and the diff is reviewed as intentional.

**Agreed policy:**

- Catalog is source of truth for package name, description, and author on init + update.
  Author is the staff ID from `spec.owner`, matching OSS OWNER; the legacy author argument is ignored.
- `version` seeds `0.1.0` and survives update; `type: module` is enforced.
- All kinds initialize private. Update enforces privacy for `forge-app` and `agent-skill`,
  preserving later `private: false` or removal for `tool` and `library`.
- Missing package → update no-op / validate skipped; existing package without catalog → update fails.
- Standalone validation uses pinned `npm-package-json-lint` structural rules, without style presets,
  autofix, catalog comparison, or policy checks. Author shape is checked separately.
- LICENSE and OWNER synchronization remain OSS responsibilities in ticket 06.
- Policy is recorded in specs/02-project-functions.md `package-metadata` and specs/01-project-kinds.md.

**Verification:** full unit/snapshot suite, typecheck, lint, format, eight real Dagger init cases,
and real Dagger validator acceptance/rejection probes passed. Snapshot changes are limited to
catalog-derived author, privacy defaults, and empty catalog descriptions.
