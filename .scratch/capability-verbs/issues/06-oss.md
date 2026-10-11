# 06: OSS — init, update, validate

**What to build:** The OSS files and the `license` field have deliberate verbs.
LICENSE, CODE_OF_CONDUCT, CONTRIBUTING and SECURITY are updated authoritatively
from the pinned upstream. README remains init-only. OWNER becomes catalog-derived
on both init and update, superseding its previous init-only policy. Validate is
an explicit no-op because these documents have no consuming validator.

**Catalog dependency (consumer wiring belongs to this ticket):** Read
`catalog-info.yaml` rather than duplicating project metadata inputs. Derive the
staff ID for `.atlassian/OWNER` from `spec.owner` (`user:default/{staff-id}`), use
`metadata.title` for project-name substitution in README/CONTRIBUTING, and use
`forge-ranch/copyright-date` for LICENSE's copyright substitution. The date is
a single year or ordered range captured in the catalog; do not advance it using
the current clock. Catalog owns the whole catalog file; OSS reads but never
modifies it. Direct OWNER edits are non-authoritative and replaced on update.
This migration is not part of introducing the catalog module.

**Today:** all six files are overwritten from the pinned upstream at
generation. The project name is substituted in README and CONTRIBUTING, the
year in LICENSE, and the owner in OWNER. A separate README generator exists but
is never used (it's dead code, removed in the contract ticket).

**Policy questions to work through:**

- LICENSE `[YYYY]`: substitute the catalog copyright date, including an ordered range; never read the current clock during OSS update.
- CONTRIBUTING carries the project name: substitute catalog `metadata.title` during authoritative update.
- Refreshing the pinned upstream is how upstream changes reach repositories through update. Is that the intended flow?
- Validate is a no-op. Record why. Note that checking the owner input format is input validation, not repository validation.

**Blocked by:** 02 (Expand — every capability has init, update and validate),
and the new catalog module (00-catalog).

**Status:** ready-for-agent

- [ ] init, update and validate are each implemented or a no-op with a reason that answers "why is there no …?".
- [ ] Each policy question is answered and recorded in the module's spec section.
- [ ] Update is idempotent: a second run changes nothing. It's tested on a freshly initialised repository and on one with owner edits.
- [ ] A filled-in README survives update; OWNER is regenerated from the catalog user owner.
- [ ] Catalog edits drive OSS name/date/owner substitutions; the catalog is not modified by OSS and copyright does not advance with the clock.
- [ ] Snapshots are updated, and the diff is reviewed as intentional.
