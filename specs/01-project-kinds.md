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
generating (`files(profile, …)`) or synchronizing (`sync(profile, …)`) a repository.

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
| Type checking | tsc | forge-pinned tsc | tsc | tsc |
| Testing | bun test (+ watch/coverage) | bun test (+ watch/coverage) | bun test (+ watch/coverage) | *no-op* |
| Build | tsdown | tsc | tsc | tsc |
| Clean | rm -rf dist | rm -rf dist | rm -rf dist | rm -rf dist |

Kind-specific policies:

- **`forge-app`** never uses `tsdown`: `build` runs `tsc -p tsconfig.json` and TypeScript
  stays on a `^5` range until the Forge bundler supports TypeScript 6. Forge-only concerns
  (manifest-adjacent scripts, Secretspec wrapping, Forge lint in the `lint` slot) belong
  to this kind and must not leak into others.
- **`library`** owns the publishing profile: `tsdown` build, library `tsconfig`, and
  publishing fields (`main`, `types`, `exports`) that `forge-app` must not emit.
- **`agent-skill`** is the only kind with a deliberate no-op testing slot; `test` and its
  variants must be absent from `package.json`, and git hooks must not reference them.

## 4. Function composition per kind

Each kind additionally selects project-functions (see
[`02-project-functions.md`](02-project-functions.md)) for concerns outside the slot model.

| Kind | Functions |
|---|---|
| `library` | oss, gitignore, node, changelog, format, typescript, aidev, test, size, git-hooks |
| `forge-app` | oss, gitignore, node, changelog, secrets, format, forge-prelint, typescript, forge-ahead, aidev, test, size, git-hooks (+ optional `evals`) |
| `tool` | oss, gitignore, node, changelog, format, typescript, aidev, test, git-hooks |
| `agent-skill` | oss, gitignore, node, format, typescript, aidev, git-hooks |

Notes:

- `evals` is enabled by `--preset all` or `--with evals`, never by default.
- `tool` and `agent-skill` are **new kinds** with no vendor parity target; their
  compositions above are provisional and should be revisited after first use.
- Optional-function selection (`--with`/`--without`) applies on top of the kind; it cannot
  remove a kind-mandated slot implementation.

## 5. Kind selection and errors

- The kind is a required argument of both generation and synchronization; unknown or
  ambiguous selection is an `InvalidOptionsError` before any filesystem work.
- Selecting a kind against an existing repository follows the same discovery → plan →
  merge path as any function application; the kind itself never authorizes overwrites.

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
