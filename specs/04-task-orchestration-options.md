# Task orchestration options: lint composition

<!-- cspell:ignore prelint -->

**Status:** Evaluation; no runner or capability-contract decision made.

This document compares ways to compose the `lint` workflow in generated
projects. It is intended to test the task-composition model against concrete
current capabilities, not to select a runner based on generic feature lists.

## 1. Decision question

When a capability contributes a check, how can it make that check run as part of
the stable `lint` workflow without requiring an edit to a separate, centrally
maintained list of checks?

Two composition models are in scope:

1. **Task-family aggregation:** a check contributes a package script whose name
   places it in a convention-based family; `lint` selects all scripts matching
   that family.
2. **Producer-declared membership:** a check declares membership in the `lint`
   workflow; composition turns those memberships into prerequisite edges from
   `lint` to each selected check.

The second model is often described as “the check runs whenever lint runs.” In
ordinary task-graph terminology, the execution edge still points from the
aggregate to the prerequisite (`lint` depends on the check). The
producer-oriented part is a membership declaration that lets the composition
layer create that edge; it is not normally an execution dependency edge from the
check back to `lint`.

A solution should be judged on whether it provides **producer-owned
composition** across Drop Calf's selected capabilities and project kinds—not
merely whether it can run commands in parallel.

## 2. Fitness criteria

| Criterion | Question |
| --- | --- |
| Producer-owned composition | Can the capability that adds a check also declare its participation, without editing a central list of checks? |
| No duplicated membership list | Does adding/removing a capability change `lint` automatically after composition? |
| Kind and selection awareness | Does the result include only capabilities selected for the project kind and preset, including optional functions? |
| Stable script interface | Can users run an individual check, and does the generated project retain the stable `lint` command? |
| Git independence | Can `lint` run without Lefthook, Git metadata, or hook configuration? |
| Runtime fit | Can the same model support Bun-oriented `library`, `tool`, and `agent-skill` projects and native-Node `forge-app` projects? |
| Graph value | Does the solution add useful prerequisite ordering, task inspection, input/output modeling, or caching beyond parallel fan-out? |
| Composition and update cost | Can init/update safely assemble, preserve, and validate the task configuration without conflicting with owner edits? |
| Proportionality | Does the execution and configuration model pay for itself for the current project scale, without blocking a future monorepo kind? |

## 3. Current lint surface

Current script ownership is deliberately distributed across capabilities in
`src/capabilities/`. The `git-hooks` capability currently owns the aggregate
`lint` and `check` package scripts; `templates/git-hooks/lefthook.yml` owns hook
dispatch. The hook's `lint` group explicitly runs the following entries with
`--if-present` and in parallel:

- `lint:prelint` from `prelint` (selected for `forge-app`);
- `lint:check` from `biome` (all kinds; Biome formatting checks are also run
  separately);
- `lint:fallow` from optional `fallow` (selected by default for `library` and
  `tool`, removable with `--without-functions fallow`);
- `lint:forge` from `prelint` (selected for `forge-app`);
- `typecheck` from `typescript` (all kinds);
- `format:check` from `biome` (all kinds).

All kinds select `docs`, which contributes `lint:docs`, but Lefthook's current
`lint` group does **not** invoke that script. Thus the current logical lint
membership is:

| Project kind | Lint checks after capability selection |
| --- | --- |
| `library` | Biome, Fallow by default (optional), typecheck, format check |
| `forge-app` | prelint, Biome, Forge lint, typecheck, format check |
| `tool` | Biome, Fallow by default (optional), typecheck, format check |
| `agent-skill` | Biome, typecheck, format check |

These are the current Lefthook members, not an endorsement that every check
should remain classified as lint. The `docs` capability contributes `lint:docs`,
but it is not currently part of the `lint` workflow; whether to add it is a
separate behavior change, not a mechanical migration. The important test case is
whether membership follows the selected capability set. `check` is a separate
wider workflow: its pre-push hook also runs tests, size checking, and package
checking when those scripts exist. Those tasks are outside this lint comparison.

There are currently two compatibility details to preserve or explicitly
reconsider:

- `lint:check` is a leaf script name today. A wildcard convention such as
  `lint:check:*` would require renaming the Biome leaf (for example,
  `lint:check:biome`) and namespacing other check leaves consistently.
- `typecheck` and `format:check` are stable public scripts as well as lint
  members. Membership should not force users to lose those direct entrypoints or
  create accidental duplicate execution.

## 4. Candidate models traced through lint

### 4.1 `npm-run-all2`: package-script family aggregation

`npm-run-all2`'s `run-p`/`run-s` accepts glob-like script-name patterns. A
pattern like `lint:check:*` matches one colon-delimited level; `lint:check:**`
includes nested levels. A glob matching no scripts is a successful no-op. That
is useful for optional capabilities, but it can also make a typo in the
aggregate pattern silently pass.

Conceptual package scripts:

```jsonc
{
  "scripts": {
    "lint": "run-p --node-run --print-label 'lint:check:*'",
    "lint:check:biome": "biome lint",
    "lint:check:prelint": "ast-grep scan ...",
    "lint:check:forge": "forge lint",
    "lint:check:fallow": "fallow --fail-on-issues",
    "lint:check:typecheck": "npm run typecheck",
    "lint:check:format": "npm run format:check",
    "lint:check:docs": "npm run lint:docs"
  }
}
```

This is illustrative, not a proposed exact naming or invocation. The `lint`
script uses a naming convention rather than an explicit list. Each capability
contributes a check-family script, and the selected capabilities determine which
scripts exist. Keep mutating tasks such as `lint:fix` outside the check
namespace. If a stable script such as `typecheck` participates, either expose a
small namespaced alias or define a supported way for the aggregator to include
the stable task without broadening the pattern into unrelated scripts.

`--node-run` asks `npm-run-all2` to execute child scripts with `node --run`
rather than re-invoking the package manager. This could provide a common
child-script runner for Bun-installed projects and native-Node Forge projects,
while preserving package-manager neutrality for dependency installation. Node's
built-in runner omits package-manager lifecycle hooks and `npm_*` environment
variables; verify the generated scripts do not depend on them. Drop Calf's kinds
already select a Node baseline, but the supported minimum Node 22 version must
be checked against `node --run` availability. If `--node-run` is not acceptable,
`--npm-path` is configurable, but Bun invocation and propagation must be tested
rather than assumed.

**What this solves:** low-ceremony automatic membership through package-script
naming. It is package-local, Git-independent, and does not require a separate
graph configuration file.

**What it does not solve:** general task prerequisites, declared inputs/outputs,
cache correctness, or task-graph visualization. The graph is one level of
parallel fan-out (plus any sequential groups explicitly written in the runner
command). Membership is implicit in a script name, so naming collisions and
pattern scope are part of the interface. Missing optional scripts are safely
ignored, but an all-missing/typo pattern also succeeds.

**Composition ownership:** package scripts are already assembled from capability
contributions. Each capability can contribute a uniquely named script;
`git-hooks` (or a new workflow-owning capability) contributes only the stable
aggregate. Existing package contributions reject duplicate script keys, which is
helpful for collisions. The main additional contract is a namespaced family and
a test that each selected lint contributor lands inside it.

### 4.2 Nx: wildcard prerequisite targets

Nx models package scripts as project targets and supports wildcard matching in
`dependsOn` (wildcards in this field are supported from Nx 19.5). Conceptually,
a `lint` target can depend on all same-project targets matching `lint:check-*`
or the chosen namespace. Then each capability contributes its own package
script/target, while Nx resolves the wildcard to the present targets and
schedules them as prerequisites.

Conceptual package scripts and project metadata:

```jsonc
{
  "scripts": {
    "lint": "nx run <project>:lint",
    "lint:check:biome": "biome lint",
    "lint:check:prelint": "ast-grep scan ...",
    "lint:check:fallow": "fallow --fail-on-issues"
  },
  "nx": {
    "targets": {
      "lint": {
        "executor": "nx:noop",
        "dependsOn": ["lint:check:*"]
      }
    }
  }
}
```

This example is intentionally **not claimed to be executable as written**: it
defines the same name, `lint`, both as a package script and as an Nx target. Nx
merges package scripts into project targets, and the script may define the
target's command, so Nx could execute the wrapper as the target and recurse. A
runnable prototype must resolve this naming/identity conflict while preserving
the stable `lint` entrypoint—for example, use a distinct underlying aggregate
target and have the stable script invoke that target, with the Nx target
metadata configured so the script itself is not inferred as the aggregate's
command. Nx's documented package-project configuration and wildcard dependencies
support the graph shape; exact root-project configuration and command resolution
remain an evidence requirement rather than a settled design.

**What this solves:** wildcard prerequisite matching expresses the graph edge at
the aggregate, avoiding enumeration of checks. Individual package scripts remain
direct commands, and Nx can add caching, inputs/outputs, task graph inspection,
and broader workspace orchestration when needed. Nx documents Bun as a package
manager, and can run against Bun workspaces; it also works with Node-based
projects.

**What it does not solve automatically:** the capability does not literally
author an inverse dependency edge saying “run me whenever lint runs.” Instead,
it contributes a target whose name matches the aggregate's wildcard. This is
still producer-independent aggregation by convention, backed by a graph. More
importantly, Nx introduces root/project metadata and an executable
aggregate-target design to generated single-package repos, even when no monorepo
is present.

**Composition ownership:** task scripts can stay capability-owned. The wildcard
edge is a single aggregate policy, likely owned by the lint/workflow composer.
The `nx` object is not currently a supported `PackageContribution` section;
package contributions only merge scripts and dependency sections at entry
granularity, and reject duplicate non-section fields. Supporting this cleanly
likely needs a dedicated, deterministic task-configuration contribution/merge
mechanism—or a single capability that owns all Nx metadata. Do not solve it by
allowing arbitrary `nx` objects to overwrite each other.

### 4.3 Turborepo: declared dependencies, central membership list

Turborepo's documented task dependencies use explicit task names (`dependsOn`)
and package-graph relationships such as `^lint`. Root tasks and package-level
configurations are supported; phantom/transit tasks can participate in ordering
without running a command. The reviewed documentation does not establish a
wildcard `dependsOn` that matches all `lint:check:*` tasks.

A Turbo lint aggregate can therefore be modeled with dependencies such as
`lint:check:biome`, `lint:check:docs`, and `lint:check:typecheck`, but the list
must be written somewhere. If every linter capability contributes a Turbo task
definition, Turbo can execute/cache those tasks, but that alone does not connect
newly contributed tasks to `lint`. Either:

- a central composer enumerates the selected task IDs and emits `turbo.json`; or
- a pre-build step derives Turbo config from capability declarations.

The latter is producer-owned at the Drop Calf model level, but it is Drop Calf's
graph composer doing the aggregation—not a Turbo feature that removes the
membership problem. Turbo can be a strong monorepo runner, but its default model
is less directly suited to wildcard family membership in one generated package.

### 4.4 Nx vs Moon vs Turbo: graph-oriented composition distinctions

Moon supports Bun and Node toolchains and can infer tasks from `package.json`
scripts. It has rich task dependencies, task configuration inheritance, and
merge strategies such as appending dependencies. The documentation reviewed
describes named task references and project scopes (`~:task`, `^:task`); it did
not establish wildcard matching of same-project task dependencies. Moon can
therefore express the lint graph if Drop Calf contributes/merges the dependency
list or uses an explicit task group/configuration convention. That composition
may be elegant, but requires generated `.moon` configuration and a clear
owner/merge strategy. Moon also brings project/workspace and toolchain concepts
beyond the immediate one-package task-family need.

| Candidate | How checks join `lint` | Can selected capability add a check without editing explicit membership list? | Runner / cache model |
| --- | --- | ---: | --- |
| `npm-run-all2` | `run-p` selects scripts by colon-pattern | Yes, by contributing a script in the designated namespace | Parallel/sequential script orchestration; no task cache or input/output graph |
| Nx | `lint` target `dependsOn` wildcard selects same-project targets | Yes, by contributing a target whose name matches the wildcard | Full task graph, caching, inputs/outputs, graph inspection; Bun and Node package-manager support |
| Turborepo | `lint` task lists prerequisite task names | Not natively shown for wildcard family membership; requires composed list/config | Full task graph, caching, inputs/outputs; strongest familiar monorepo fit, but list composition remains |
| Moon | `lint` task lists named `deps`; inherited config can merge dependencies | Not established for wildcard dependencies; needs composed config or explicit dependency list | Full task graph, inputs/outputs, cache, Bun/Node toolchains and project model |

## 5. Cross-cutting composition model

Runner syntax alone does not settle the capability design. Today
`PackageContribution` has `seed`, `policy`, and `remove`; top-level package
sections such as `scripts` are merged by entry, and duplicate entries are
rejected. Other top-level objects are treated as a single owner-owned field.
This is deliberately simple and does not express additive graph membership.

If future requirements include tool-neutral or runner-specific graph
declarations, consider adding a typed contribution concept separate from
`packageJson`, for example:

```ts
{
  task: "lint:check:biome",
  workflowMembership: ["lint"],
  execution: "parallel"
}
```

The composer would resolve only selected capabilities, reject duplicate task
IDs, and build the execution model. A runner adapter could then emit either:

- a package-script family and `run-p` command;
- Nx targets and `dependsOn` edges;
- Turbo task config with explicit prerequisites; or
- Moon task config with merged `deps`.

This model keeps the capability interface stable if the runner changes, but
creates a new abstraction and a generator-owned graph composer. It should only
be introduced if multiple workflows or runner features need it. For the current
lint use case, `npm-run-all2`'s naming family may offer a better
leverage-to-interface ratio; Nx is the strongest candidate if explicit graph
semantics and future monorepo orchestration justify the extra configuration and
task metadata.

Do not have every capability mutate a shared `dependsOn` array ad hoc. That
would hide collisions, ordering, optional selection, and update ownership in
generic JSON merging. If graph contributions are implemented, composition should
be deterministic and tested from the resolved capability list.

## 6. Preliminary findings and evidence needed

### Preliminary findings

- `npm-run-all2` is the smallest candidate that directly eliminates the manually
  enumerated lint list through a task-name family. It may be sufficient if the
  immediate requirement is parallel grouping and stable per-check scripts.
- Nx is the most promising graph-oriented candidate for the stated “producer
  adds a task; aggregate depends on matching tasks” pattern because `dependsOn`
  supports wildcards. It preserves this benefit through task naming, not through
  an inverse edge authored independently by every producer.
- Turbo and Moon remain viable if their broader monorepo, caching, or toolchain
  capabilities are desired, but current evidence suggests Drop Calf would still
  have to compose the selected lint prerequisites or configuration centrally.
- Bun package-manager support is no longer a decisive objection to Nx or Moon.
  Native-Node Forge is also compatible with graph tools in principle. Validate
  exact generated invocation and required Node version for each kind.
- None of the candidates should be adopted solely for caching. Lint checks are
  read-only, but inputs must include configs, source, and relevant
  toolchain/dependency files; cache behavior and correctness should be a
  separate decision.

### Required prototype checks

Before choosing a runner, reproduce these cases against generated manifests for
all four kinds:

1. `lint` runs without Git metadata and without Lefthook installed/configured.
2. Only selected tasks run: Fallow is absent when opted out; Forge tasks occur
   only in `forge-app`; docs remains included where selected.
3. Add a synthetic lint capability and verify it joins the aggregate without
   editing the aggregate command or explicit task list (except for graph
   configuration if required by that candidate).
4. Remove that capability and verify its task is absent from the execution
   graph.
5. A missing namespace match has intentional behavior: distinguish valid empty
   optional groups from a typo in the aggregate pattern.
6. A failing child returns non-zero, reports useful task identity, and does not
   leave unrelated child processes running indefinitely.
7. `lint:fix` and other mutating tasks are not selected by the read-only lint
   aggregate.
8. Preserve direct `typecheck`, `format:check`, and individual lint check
   entrypoints without duplicate execution.
9. Exercise both `bun run lint` and `npm run lint` for representative Bun and
   Forge projects. If using `npm-run-all2 --node-run`, verify the minimum
   supported Node version, child PATH resolution, and absence of reliance on
   package-manager lifecycle variables.
10. If evaluating cache, change each relevant source/config/toolchain input and
    verify invalidation; verify no stale check result is reused.

### References

- Current composition: `src/composition/profiles.ts`,
  `src/capabilities/git-hooks.ts`, `src/capabilities/biome.ts`,
  `src/capabilities/prelint.ts`, `src/capabilities/fallow.ts`,
  `src/capabilities/docs.ts`, `src/capabilities/typescript.ts`,
  `templates/git-hooks/lefthook.yml`, `src/core/package-json.ts`.
- [`npm-run-all2`: glob-like script matching and
  `run-p`](https://github.com/bcomnes/npm-run-all2/blob/master/docs/run-p.md),
  [`run-s`](https://github.com/bcomnes/npm-run-all2/blob/master/docs/run-s.md),
  and [Node `--run`
  option](https://github.com/bcomnes/npm-run-all2/blob/master/README.md).
- [Nx project configuration and wildcard
  `dependsOn`](https://nx.dev/docs/reference/project-configuration), [Nx task
  model and inferred targets](https://nx.dev/docs/concepts/mental-model), [Nx
  Bun support](https://nx.dev/docs/kb/use-bun), and [Nx root-level
  tasks](https://nx.dev/docs/kb/root-level-scripts).
- [Turborepo task
  configuration](https://turbo.build/repo/docs/crafting-your-repository/configuring-tasks)
  and [package
  configurations](https://turbo.build/repo/docs/reference/package-configurations).
- [Moon project task configuration](https://moonrepo.dev/docs/config/project),
  [task inheritance and merge
  strategies](https://moonrepo.dev/docs/concepts/task-inheritance), and [Bun
  handbook](https://moonrepo.dev/docs/guides/javascript/bun-handbook).
