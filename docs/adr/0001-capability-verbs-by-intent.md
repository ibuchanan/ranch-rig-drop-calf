# ADR 0001: Capabilities have three verbs, decided by intent

- **Status:** Accepted
- **Date:** 2026-10-11

## Context

Drop Calf bootstraps and maintains repositories by composing capabilities. The
original overview proposed a single `addTo` operation and a future `sync` engine
whose merge rules were selected by file type. The functions specification also
required universal preservation of owner edits and made validation optional at
the capability level but automatic after mutation.

These rules conflate starting content, ongoing policy, and tool acceptance. A
file's format cannot tell us its intended lifecycle: OSS policy documents should
follow the pinned upstream, while a project's README and OWNER should not be
replaced after initialization. Conversely, several capabilities can contribute
to one resource, such as `package.json` or `manifest.yml`.

## Decision

Every capability has three required verbs:

- **`init`** seeds starting content and initial settings. It is first-time setup,
  not the operation for maintaining an already-initialized repository.
- **`update`** applies a policy-driven delta, such as updating a pinned tool or
  enforcing a setting. With the same inputs and policy, running it again produces
  no further changes.
- **`validate`** checks whether the consuming tools accept the repository as it
  stands. It is read-only and is not policy-aware: an owner-edited configuration
  that the tool accepts passes even if it differs from the current baseline.

A verb with no work is an explicit **no-op with a non-empty reason**. The reason
answers why that capability has no work for that verb and is available as data
for documentation. An omitted verb does not express a decision.

The capability's intent and documented policy determine which verb changes each
output and whether to preserve or replace owner edits. File-format helpers may
implement those decisions but do not choose them. A documented update policy is
sufficient authority to replace content; no explicit opt-in or `--force` is
required. Shared resources are changed only within the capability's declared
scope, preserving unrelated content.

For example, OSS updates LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, and SECURITY
authoritatively from the pinned upstream. README and OWNER are init-only and
survive update. OSS has no repository validation because these documents have
no consuming tool whose acceptance it checks; owner input checks remain input
validation. Substitution details, including copyright-year handling, are decided
in the OSS policy, not here.

Top-level operations compose separate passes in the selected profile's order:

- **`init`** = scaffold steps, then every capability's `init`, then every
  capability's `update`.
- **`update`** = every capability's `update`.
- **`validate`** = every capability's `validate` against the same fully composed
  repository, reporting validated, skipped with a reason, or failed.

`validate` is independently usable, including on a repository that has never run
Drop Calf's `init` or `update`. Neither mutation operation automatically invokes
it for now. If automatic validation is added later, it runs after the complete
mutation pass, not between capabilities: intermediate shared resources need not
be acceptable to their tools. Standalone top-level validation remains available.
Checks needed to apply a change safely, such as rejecting malformed input, are
part of the mutation operation and are not this separate validation pass.

The `files` operation is retired. A project without a `forge create` scaffold is
initialized from an empty directory, where scaffold steps have nothing to do.
Scaffold steps prepare fresh scaffolder output before capability initialization;
they are not repository-maintenance steps and do not run during update. The old
`sync` vocabulary becomes `update`.

## Alternatives considered

### Generic convergence engine with merge rules per file type

Rejected as the policy authority. A line-set, structured merge, managed region,
or whole-file replacement can be a useful implementation technique, but none can
decide whether a particular output should track policy or remain owner-authored.
A generic engine would hide that decision in technology-based defaults.

### Optional verbs

Rejected. Missing methods cannot distinguish a deliberate no-op from an
unfinished capability and cannot explain the omission in generated documentation.
Requiring all three verbs makes these decisions explicit.

### Validation coupled to mutation or policy compliance

Rejected for now. Per-capability validation during mutation can observe
incomplete shared resources; mutation-only validation cannot assess an arbitrary
repository independently. Policy-compliance checks would also reject otherwise
valid owner configurations. Tool acceptance is a separate concern from applying
Drop Calf policy.

## Consequences

- Capability policies must explicitly identify init-only content, authoritative
  updates, and the scope of changes to shared resources. Owner edits to
  authoritative content may be lost on update; Git diffs remain reviewable.
- Updates are idempotent, but initialization is not a safe maintenance rerun.
  Init preconditions and the refusal-or-warning behavior are a separate decision.
- Tool acceptance does not establish policy compliance, and a skipped validator
  is not evidence that a tool accepted the resource.
- File-format helpers remain reusable without becoming a universal merge engine.
  No-op reasons provide a common source for documentation.
- This ADR records the target contract, not a completed code migration. The
  expand–contract work retains the old shape temporarily, adds required verbs,
  migrates each capability's policy, retires `files`, and removes the old shape.

## Related specifications

- [Overview and domain terms](../../specs/00-drop-calf-overview.md)
- [Project kinds and composition](../../specs/01-project-kinds.md)
- [Project-function contract and policies](../../specs/02-project-functions.md)
