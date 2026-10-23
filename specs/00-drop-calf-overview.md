# Drop Calf specification

## 1. Purpose

`drop-calf` is a Dagger module that bootstraps and maintains software repositories. A **project profile** selects an ordered set of **capabilities** whose intent and policy determine how the repository changes.

A human declares intent by choosing a profile (e.g., `library`, `forge-app`, `tool`, `agent-skill`). Each profile assembles the same capability slots, but each slot may be fulfilled by a different implementation. The module initializes new projects, updates existing projects according to capability policy, and independently validates tool acceptance.

[ADR 0001: Capabilities have three verbs, decided by intent](../docs/adr/0001-capability-verbs-by-intent.md) supersedes the original single-operation convergence model. This specification describes the current contract; future work is listed in §7.2 and §14.

## 2. Goals

- Produce consistent, working repositories for common project kinds.
- Keep the generated developer API stable (`npm run lint`, `npm run format`, `npm run typecheck`, `npm run test`) while allowing implementation to vary by profile.
- Support idempotent, policy-driven updates to existing repositories.
- Make preservation or replacement of owner edits an explicit capability policy, not a rule inferred from file type.
- Remain testable without the Dagger engine for the core abstraction.

## 3. Non-goals

- Replace project-specific scaffolding tools such as `forge create`. `drop-calf` composes on top of fresh scaffold output or initializes an empty directory.
- Track persistent state inside Dagger. State lives in Git and in the repository files themselves.
- Enforce a single toolchain across all project kinds. Profiles may choose different tools.
- Build a generic convergence engine whose file-format rules decide repository policy.
- Treat validation as a policy-compliance or drift check.

## 4. Core concepts

| Term                 | Definition                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Profile**          | A named, ordered bundle of capabilities that defines a project kind. Examples: `library`, `forge-app`, `tool`, `agent-skill`.                                                        |
| **Capability**       | One repository concern with explicit initialization, update policy, and tool-validation behavior, such as formatting, testing, or OSS documents.                                     |
| **Capability slot**  | A role in a profile, such as `linting`, `formatting`, `typechecking`, `testing`. A profile always has the same slots, but implementations vary and slots may deliberately be no-ops. |
| **Init**             | First-time setup that seeds starting content and initial settings; at the top level, scaffold preparation followed by all capability inits and then all capability updates.          |
| **Update**           | Application of a capability's current policy to a repository; repeating it with the same inputs and policy produces no further changes.                                              |
| **Validate**         | A read-only check of whether consuming tools accept the repository, independent of Drop Calf policy and of any prior init or update.                                                 |
| **No-op reason**     | An explicit explanation of why a capability has no work for a required verb; not an omitted operation.                                                                               |
| **Scaffold step**    | Preparation of fresh scaffolder output before capability initialization; it has no work on an empty directory and does not run during update.                                        |
| **ProjectBlueprint** | A pure TypeScript model of a project: a `package.json` object plus a map of file paths to contents.                                                                                  |
| **Seam**             | The boundary between the pure blueprint manipulation and the Dagger `Directory` rendering.                                                                                           |

## 5. Capability contract

Every capability requires `init`, `update`, and `validate`. A verb with no work is an explicit no-op with a non-empty, enumerable reason that answers why there is no work for that verb and anchors its documentation.
- `init` seeds starting content and initial settings.
- `update` applies the capability's documented policy and is idempotent for unchanged inputs and policy.
- `validate` checks tool acceptance without changing the repository. It is not policy-aware: a tool-valid configuration passes even if it differs from the capability's baseline.

Each capability declares the scope of its changes. Its policy decides whether content is init-only, updated authoritatively, or changed selectively within shared resources. Documented policy authorizes replacement of owner edits without an explicit opt-in or `--force`; unrelated content in shared resources is preserved. These decisions are not inferred from file type.

The previous `addTo` interface was superseded by [ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md) and has been removed. The concrete verb signatures are in `src/core/capability.ts`.

## 6. Developer API (package.json scripts)

Every non-empty capability slot contributes to the stable developer API. The exact command may vary by profile.

| Slot          | Script(s)                             | Example implementations                                                                         |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Linting       | `lint`, `lint:fix` (optional)         | `biome lint`, `forge lint`                                                                      |
| Formatting    | `format`, `format:check`              | `biome format --write`, `biome format`                                                          |
| Type checking | `typecheck`                           | `tsc --noEmit`                                                                                  |
| Testing       | `test`, `test:watch`, `test:coverage` | Bun (`library`, `tool`, `agent-skill`), Vitest (`forge-app`), both with a no-tests starter flag |
| Build         | `build`                               | `tsc`                                                                                           |
| Clean         | `clean`                               | `rm -rf dist`                                                                                   |
| TODO lookup   | `todo`                                | `git grep` on tracked files                                                                     |

## 7. Profiles

Profiles are defined in `src/composition/profiles.ts` as arrays of capabilities.

### 7.1 Initial profiles

| Profile       | Linting    | Formatting | Type checking    | Testing                                |
| ------------- | ---------- | ---------- | ---------------- | -------------------------------------- |
| `library`     | biome      | biome      | tsc              | bun test (with `--pass-with-no-tests`) |
| `forge-app`   | forge lint | biome      | forge-pinned tsc | vitest (with `--passWithNoTests`)      |
| `tool`        | biome      | biome      | tsc              | bun test (with `--pass-with-no-tests`) |
| `agent-skill` | biome      | biome      | tsc (no emit)    | bun test (with `--pass-with-no-tests`) |

### 7.2 Future profiles

Additional profiles may be added without changing existing capability implementations, provided the new profile uses the same capability contract.

## 8. Content policy and file-format helpers

The former merge-strategy table is superseded by [ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md). File type does not decide whether an output is seeded, preserved, merged, or replaced.

A capability may use line-set, section-map, structured-key, managed-region, or whole-file operations to implement its documented policy. None is a universal default. For example, OSS updates LICENSE, CODE_OF_CONDUCT, CONTRIBUTING, and SECURITY authoritatively, while README is init-only. The catalog decision superseded the former init-only OWNER policy: OSS derives OWNER from catalog metadata on init and update. Their common document format does not imply a common lifecycle.

The catalog capability owns a single root `catalog-info.yaml` as the language-independent project metadata source. Initialization seeds it from an authored template; update is an explicit no-op until a policy is defined. Package metadata and OSS read it without editing it; see the [shared metadata contract](02-project-functions.md#shared-metadata-contract).

Detailed policies and substitutions belong to the owning capability's specification.

## 9. Repository initialization

Top-level `init` composes these phases in order:
1. Run scaffold steps to prepare fresh `forge create` output, or do nothing on an empty directory.
2. Run every selected capability's `init` in profile order.
3. Run every selected capability's `update` in profile order against the initialized repository.
4. Return the resulting Dagger `Directory` or changeset for review and export.

`files` is retired; projects without a scaffold are initialized from an empty directory. `init` is first-time setup, not a maintenance operation. Exact init preconditions and the refusal-or-warning behavior on an already-initialized repository are specified separately.

## 10. Repository update and validation

The former `sync` convergence engine is superseded by [ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md). The canonical term is `update`.
- Top-level `update` runs every selected capability's `update` in profile order against the supplied repository. The caller can review the resulting Git diff and commit it. Repeating an update with the same inputs and policy produces no changes.
- Top-level `validate` independently runs every selected capability's `validate` against the same fully composed repository, reporting validated, skipped with a reason, or failed. It does not change repository contents or require prior initialization or update.
- Neither `init` nor `update` automatically invokes validation for now. Any future automatic validation runs only after all mutation phases complete, since shared resources such as `package.json` and `manifest.yml` may be changed by several capabilities. Standalone validation remains available.
- Input checks needed to apply changes safely, such as rejecting malformed input, remain part of mutation operations; they are distinct from repository validation.

## 11. Example-driven canonicalization

Profiles may be derived from existing example repositories:
1. Extract a `ProjectBlueprint` from each example repo.
2. Canonicalize the set of blueprints into a profile (common scripts, dependencies, config files).
3. Human reviews and curates the derived profile and its capability policies.
4. The profile is committed and used for initialization and updates.

This is an optional workflow, not a requirement for the initial implementation.

## 12. Testing strategy

- Unit tests target pure blueprint manipulation and capability adapters. No Dagger engine required.
- Tests verify each capability's declared policy: expected settings, idempotent updates, authoritative replacements, and preservation of init-only and unrelated content.
- Tests verify all three verbs are present and no-op reasons are non-empty and enumerable.
- Validation tests distinguish tool acceptance from policy compliance and verify repository contents remain unchanged.
- Snapshot tests document expected capability and full-profile outputs.
- Dagger-level tests verify initialization from an empty directory and a fresh scaffold, as well as top-level update and validation composition.

## 13. Dagger's role

Dagger provides the runtime seam for:
- Reading existing directories (`dag.host().directory(...)`).
- Rendering resulting directories and changesets.
- Running containerized tools when needed (e.g., configuration validation, dependency installation, test suites).
- Caching expensive operations.

Dagger does **not** track persistent project state. State lives in Git and in the repository files.

## 14. Open questions and future work

The [OKF parity decision register](03-okf-parity-open-questions.md) records
unresolved differences from the OKF example without changing current policy.
- How should the README reflect the chosen test runner and other capabilities? Currently the base README is static.
- Should profile selection support a default based on project metadata, or only explicit selection?
- Should `update` support selecting only certain capability slots?
- Should a complete update pass automatically invoke validation while retaining standalone `validate`?
- How are example repositories pinned and versioned for canonicalization?

### 14.1 Carried over from the `init-repo` design

These ideas from the [`init-repo`](https://github.com/ibuchanan/init-repo) design
(`specs/esa-repo-init-spec.md`) have no counterpart here yet. Each needs its own
decision before it is specified.
- **Prerequisite report (`doctor`).** Report missing host tools that generated
  projects still need outside Dagger (`forge`, `secretspec`, `gitleaks`, `git`)
  without installing them. `validate` checks repositories, not hosts.
- **Reviewable update.** `init-changes` returns a changeset, but `update` returns
  only a directory; an `update-changes` counterpart would give existing
  repositories the same review path.
- **Forge architecture tests.** Seed the `test/forge/**` architecture suite, as in
  the [OKF producer example](https://github.com/ibuchanan/explore-forge-confluence-okf-producer),
  from the Forge testing capability.
- **Capability subsets.** Apply selected capabilities to an existing repository
  (`apply --function <name>`), related to the slot-selection question above.
- **Monorepo composition.** A `monorepo` kind and a command that adds child
  projects at a path (workspaces, Turbo); see
  [`01-project-kinds.md`](01-project-kinds.md#6-future-kinds).
- **Additional scripts.** `dev` (watch), `generate`/`generate:rovo`, and
  a separate encrypted-variables script from the `init-repo` script table;
  `forge:variables:set` already uploads encrypted through Fence Rider.
- **Error classes.** `PrerequisiteError` and `ValidationError` alongside
  `ParseError` and `InvalidOptionsError`.

Deliberately not carried over: `--force`/`--merge`, conflict reports, and
file-type mutation modes (superseded by
[ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md)); the initialization
journal (state lives in Git, §3); and procedural `biome init` in place of pinned
templates.
