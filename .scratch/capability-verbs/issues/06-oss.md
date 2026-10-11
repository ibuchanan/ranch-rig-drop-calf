# 06: OSS — init, update, validate

**Status:** implemented

## Agreed policy

Catalog is the source of truth; consumers pull metadata rather than push competing defaults.
The catalog template seeds `forge-ranch/license: Apache-2.0` as a literal annotation.
Node pulls it into an existing `package.json.license` during update, including init's
final update pass. Node preserves unrelated fields and does not create a missing package.
OSS no longer contributes package license metadata to the blueprint.

OSS owns these six files: `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
`README.md`, `SECURITY.md`, and `.atlassian/OWNER`. Docs owns `DEVELOPMENT.md` separately.

| Catalog field | OSS use |
|---|---|
| `metadata.title` | Project name in README and CONTRIBUTING |
| `spec.owner` | User reference's staff ID in OWNER |
| `metadata.annotations["forge-ranch/copyright-date"]` | LICENSE copyright year or ordered range |
| `metadata.annotations["forge-ranch/license"]` | Must equal Apache-2.0 for the pinned LICENSE template |

All consumed OSS values are required. Missing catalog, malformed YAML, missing/invalid
values, or a license other than Apache-2.0 fail clearly before asset writes. OSS reads
but never modifies catalog; direct OWNER edits are non-authoritative.

- **init:** Declare the pinned OSS seed tree after catalog; render all six files
  from the actual catalog bytes, not duplicate name/owner arguments.
- **update:** Create or authoritatively replace the five files other than README.
  Preserve README, including absence; regenerate OWNER from catalog. Matching
  content retains its bytes; a second update changes nothing.
- **validate:** Explicit no-op: "These documents require manual inspection; no
  consuming validator checks their acceptance." Checks on catalog inputs are
  mutation preconditions, not repository validation or full catalog validation.

## Policy answers

- LICENSE `[YYYY]` uses the recorded catalog date, including ordered ranges;
  OSS never reads the current clock. Catalog captures its default once at init.
- CONTRIBUTING uses current catalog `metadata.title` on authoritative update.
- `bun run refresh:oss` deliberately refreshes the vendor pin; subsequent repository
  updates consume that pin. OSS never fetches upstream during init/update.
- Standalone `copy-oss` now takes only a directory containing catalog and deliberately
  re-seeds all six files, including README. It is not the maintenance operation.
- OWNER accepts the same user references as catalog, including namespaced and
  shorthand forms, and extracts the staff ID.

## Acceptance

- [x] init, update, and validate are implemented or explicit reasoned no-ops.
- [x] Policies are recorded in specs/02-project-functions.md and DEVELOPMENT.md.
- [x] Node pulls package license from catalog; OSS requires the matching Apache template.
- [x] Catalog edits drive title/date/owner substitutions without modifying catalog.
- [x] Tests reject clock use during OSS copying/update.
- [x] README survives update; all five authoritative files replace owner edits.
- [x] OWNER is regenerated from catalog on init and update.
- [x] Updates are idempotent on fresh and owner-edited repositories.
- [x] Snapshots updated and reviewed: package-key ordering only, unchanged values/files.

## Verification

- Latest full unit/snapshot run: 321 passed, 18 opt-in E2E tests skipped, no failures.
- Typecheck, lint, formatting, and git diff whitespace checks passed.
- Eight real Dagger empty-directory init cases passed (all kinds, default/all presets).
- Two real Dagger edited-repository updates passed (library and forge-app), checking
  README/catalog preservation, pinned document replacement, catalog OWNER, input
  immutability, and empty second-update diffs.
- Upstream pin was not refreshed; no dependencies were added; no commit was made.
