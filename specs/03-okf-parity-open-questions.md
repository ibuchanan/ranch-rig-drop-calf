# OKF parity: open questions

This is a decision register, **not** a change to the current capability contract.
The questions arose from comparison with the
[OKF producer example](https://github.com/ibuchanan/explore-forge-confluence-okf-producer),
previously vendored here. Its choices are evidence, not requirements for every
Drop Calf project kind. Until a question is decided, the current behavior in
[`02-project-functions.md`](02-project-functions.md) remains authoritative.

## Forge and TypeScript

### 09 — DOM types in Forge apps

- **Current state:** The Forge base `tsconfig.json` seeds `lib: ["ES2022"]`;
  the OKF example adds `DOM`.
- **Question:** Does a freshly initialized app with a minimal UI Kit frontend
  and resolver pass `npm run typecheck` without DOM types? If not, should `DOM`
  be in the base config, typecheck config, or neither?
- **Evidence needed:** Reproduce with that frontend and resolver, including
  `@forge/bridge` types; record the failing symbols and the smallest compatible
  config change. Do not infer a universal setting from the OKF app alone.

### 10 — Additional TypeScript compiler options

- **Current state:** The generated base config does not explicitly set
  `resolveJsonModule`, `moduleDetection: "force"`, or `allowJs: false`.
  `noUncheckedIndexedAccess` and `noImplicitReturns` already live in the
  typecheck config; `strict` is enabled.
- **Question:** For each of the three missing options, should Drop Calf adopt
  it, for which kinds, and as an init seed or update-enforced policy? Explicit
  `allowJs: false` may only restate the TypeScript default; determine whether
  writing it adds value.
- **Evidence needed:** Test any adopted option against Forge's `ts-loader` as
  well as local typechecking. Keep Forge base and typecheck config constraints
  distinct.

### 14 — Forge custom scopes before deployment

- **Current state:** The OKF example creates custom scopes from
  `custom-scopes.yaml` before deploy. Drop Calf's `forge:deploy` runs through the
  SecretSpec helper without that step; `forge-manifest` does not seed module
  wiring.
- **Question:** Should projects needing custom scopes opt in, should a manifest
  trigger the behavior, or should owners manage it themselves? If supported,
  how does it compose with SecretSpec without changing deployment for apps that
  do not use custom scopes?
- **Evidence needed:** A representative custom-scope app and a verified deploy
  sequence; do not assume every app with an API route needs the same workflow.

## Repository defaults

### 11 — Seed `.gitattributes`

- **Current state:** Drop Calf's own `.gitattributes` has special rules for SDK
  files and `vendor/gitignore`, but does **not** contain the proposed
  `* text=auto eol=lf` rule. The generated `.editorconfig` concerns editors,
  not Git normalization. No capability currently seeds `.gitattributes`.
- **Question:** Should a generated repository have that Git-wide normalization
  rule? If so, which capability owns it, is it seed-only or update policy, and
  are any kind-specific binary or linguist rules needed?

### 12 — Seed `.node-version` alongside `.nvmrc`

- **Current state:** `node` seeds and updates `.nvmrc`, and validation asks
  `fnm` to select it. Existing `.node-version` files are not managed.
- **Question:** Is supporting version managers that read `.node-version` worth
  maintaining two Node-version files? If yes, should both follow the same
  update policy, and how should validation check each file and their agreement?

### 17 — Seed ADR and glossary starters

- **Current state:** Drop Calf itself has `docs/adr/` and root `GLOSSARY.md`;
  this does not mean generated projects have them. The `docs` capability seeds
  Diátaxis and spec placeholders, but neither an ADR nor a glossary.
- **Question:** Should generated projects include an ADR location/template and
  a domain glossary? If yes, choose the canonical glossary name (`GLOSSARY.md`
  or `CONTEXT.md`) and document the layout in seeded `DEVELOPMENT.md`.
- **Evidence needed:** Starter files must pass `lint:docs`. Revisit after the
  repository-layout work (formerly parity ticket 05).

## First install

### 19 — npm lifecycle-script approval

- **Current state:** `git-hooks` seeds `prepare: lefthook install || true` for
  Forge apps, tools, and agent skills. Libraries instead run the canonical build
  before best-effort hook installation. The OKF example carries a version-specific
  `allowScripts` list from owner approval; Drop Calf does not seed one.
- **Question:** Does a fresh generated repo require an explicit npm script
  approval for Lefthook to install? If so, document the owner action in
  `DEVELOPMENT.md`, seed a safe configuration, or leave approval to npm?
- **Evidence needed:** Run `npm install` in a fresh generated repo under the
  supported npm environment and record whether `prepare` runs and hooks are
  installed. Avoid copying the OKF example's version-specific allowlist.

## Already settled (not carried forward as questions)

- **08 — Fallow by kind:** [`ADR 0003`](../docs/adr/0003-fallow-by-project-kind.md)
  selects Fallow by default for `library` and `tool`, permits opting out, and
  excludes `forge-app` and `agent-skill` for now.
- **15 — Size Limit pin:** Both `size-limit` and `@size-limit/file` now use the
  same pin, and the version/Node/CLI notes and freshness policy are in
  [`02-project-functions.md`](02-project-functions.md#sizecheck). The original
  11-to-13 question is stale.
- **16 — Changelog mode:** The enforced command regenerates `CHANGELOG.md`
  whole rather than prepending; the rationale and owner-managed-file boundary
  are in [`02-project-functions.md`](02-project-functions.md#changelog).

The dotenv and Vitest-globals decisions from the parity review were already
closed and are not open questions here.
