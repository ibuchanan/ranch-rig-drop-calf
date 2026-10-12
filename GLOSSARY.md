# Drop Calf

Drop Calf bootstraps and maintains repositories by composing capabilities into
profiles. This glossary names the concepts behind that composition.

## Language

**Capability**:
A unit of repository setup that owns a coherent set of outputs and the intent
behind each one.
_Avoid_: function, feature, plugin

**Policy**:
Output a capability keeps current on every update, replacing owner edits, such
as a pinned tool version or an enforced script.
_Avoid_: enforced fields, managed content, convergence rule

**Seed**:
Starting content a capability writes once at init, which the owner manages
afterwards.
_Avoid_: init-only, default, scaffold

**Contribution**:
The seed and policy entries a capability declares for a shared file that no
single capability owns.
_Avoid_: patch, fragment, overlay

**Pin**:
The exact version of a tool that Drop Calf seeds and keeps fresh.
_Avoid_: tool version, range, latest

**Freshness**:
The guarantee that seeded dependencies are never older than Drop Calf's pinned
versions, without downgrading versions the owner chose.
_Avoid_: dependency sync, auto-upgrade
