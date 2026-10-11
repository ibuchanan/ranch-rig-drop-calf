# Project kinds specification

Defines the project kinds Drop Calf (`drop-calf`) generates and maintains. A
project kind is the **Profile** concept from
[`00-drop-calf-overview.md`](00-drop-calf-overview.md): a named composition of
capabilities that fills a fixed set of capability slots. The individual
capabilities are specified in [`02-project-functions.md`](02-project-functions.md).

## 1. Purpose

A kind answers one question: *given a capability slot, which implementation does this kind
use?* Kinds contain no behavior of their own — they are pure composition data, declared in
`src/profiles.ts` as ordered arrays of capabilities, and are the unit users select when
initializing (`init`), updating (`update`), or validating (`validate`) a repository.
[ADR 0001](../docs/adr/0001-capability-verbs-by-intent.md) defines these operations:
init runs scaffold steps, then every capability's init, then every capability's
update; update and validate each run only their respective capability pass. Each
pass follows kind order. Validation is standalone and is not automatically run by
init or update for now; it checks tool acceptance, not kind-policy compliance.

## 2. Kind contract

Every kind:

- has a unique `name` and is explicitly selected; there is no metadata-based default kind;
- fills **every** capability slot with exactly one implementation or an explicit no-op
  (a slot may be empty, but only deliberately — e.g., testing in `agent-skill`);
- is an **ordered** capability list; application order is part of the kind's contract and
  determines script/placeholder precedence;
- must not rename the stable developer API (`lint`, `format`, `typecheck`, `test`,
  `build`, `clean`) — kinds choose implementations per slot, never new script names;
- must be addable without changing existing capability implementations
  (overview §7.2);
- resolves to an `InvalidOptionsError` when unknown.

## 3. Capability slots per kind

| Slot | `library` | `forge-app` | `tool` | `agent-skill` |
|---|---|---|---|---|
| Linting | biome | forge lint | biome | biome |
| Formatting | biome | biome | biome | biome |
| Type checking | tsc | tsc | tsc | tsc |
| Testing | bun test (+ watch/coverage) | vitest (+ watch/coverage) | bun test (+ watch/coverage) | *no-op* |
| Build | tsdown | tsc | tsc | tsc |
| Clean | rm -rf dist | rm -rf dist | rm -rf dist | rm -rf dist |

Kind-specific policies:

- **Package privacy:** every kind starts with `private: true`. Update enforces this
  for `forge-app` and `agent-skill`; `tool` and `library` preserve later owner changes
  to `private` so they can become npm-published artifacts.
- **`forge-app`** never uses `tsdown`: `build` runs `tsc --project tsconfig.json`. Forge-only
  concerns (manifest-adjacent scripts, Secretspec wrapping, Forge lint in the `lint` slot) belong
  to this kind and must not leak into others.
- **`library`** owns the publishing profile: `tsdown` build and publishing fields (`main`,
  `types`, `exports`) that `forge-app` must not emit.
- **`agent-skill`** is the only kind with a deliberate no-op testing slot; `test` and its
  variants must be absent from `package.json`, and git hooks must not reference them.

## 4. Function composition per kind

Each kind additionally selects project-functions (see
[`02-project-functions.md`](02-project-functions.md)) for concerns outside the slot model.

| Kind | Functions |
|---|---|
| `library` | catalog, package-metadata, oss, gitignore, node, changelog, format, typescript, aidev, test, size, git-hooks |
| `forge-app` | catalog, package-metadata, oss, gitignore, node, changelog, secrets, format, forge-prelint, typescript, forge-ahead, aidev, test, size, git-hooks (+ optional `evals`) |
| `tool` | catalog, package-metadata, oss, gitignore, node, changelog, format, typescript, aidev, test, git-hooks |
| `agent-skill` | catalog, package-metadata, oss, gitignore, node, format, typescript, aidev, git-hooks |

Notes:

- Forge testing (Vitest) runs before TypeScript in the ordered composition: its
  dependency update must be visible to compiler-policy reconciliation on the first pass.
  The function table is an inventory, not an execution-order override.
- `evals` is enabled by `--preset all` or `--with evals`, never by default.
- `tool` and `agent-skill` are **new kinds** with no vendor parity target; their
  compositions above are provisional and should be revisited after first use.
- Optional-function selection (`--with`/`--without`) applies on top of the kind; it cannot
  remove a kind-mandated slot implementation.

## 5. Kind selection and errors

- The kind is a required argument of initialization, update, and validation; unknown or
  ambiguous selection is an `InvalidOptionsError` before any filesystem work.
- Selecting a kind against an existing repository runs the selected capability pass.
  Preservation or replacement follows each capability's documented policy, not a
  generic merge path; the kind itself adds no overwrite policy.
- Every selected capability requires all three verbs, including explicit no-ops with
  reasons. A deliberate no-op slot does not omit the capability's verb contract.

## 6. Future kinds

- **`monorepo`** — root coordination (workspaces, aggregate scripts/hooks, child kinds
  added explicitly). Deferred; child-composition rules come from the vendor design when
  this kind is specced.
- **Python-based kinds** — explicitly second-class; the capability interface must not
  preclude them, but no Python kind is in scope.

## 7. Testing expectations

Per kind, tests must assert:

- every slot is filled or explicitly no-op (no accidental gaps);
- the stable developer API scripts exist and match the kind's slot implementations;
- kind-specific policy holds (e.g., `forge-app` has no `tsdown` dependency and no
  publishing fields; `agent-skill` has no `test` scripts);
- the full generated blueprint matches a per-kind snapshot;
- an unknown kind fails with `InvalidOptionsError` before any mutation.

## 8. Terminology mapping (vendor traceability)

| This project | `vendor/init-repo` |
|---|---|
| project kind (Profile) | catalog kind |
| `library` | `typescript-library` |
| `forge-app` | `forge-app` |
| `tool`, `agent-skill` | (no counterpart) |
| `monorepo` | `monorepo` (deferred here) |
