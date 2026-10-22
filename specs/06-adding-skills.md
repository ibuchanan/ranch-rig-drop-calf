# Adding skills to an agent-skill project

Status: **draft, open decisions**. This spec does not change the current
capability contract in [`02-project-functions.md`](02-project-functions.md).

## Problem

An `agent-skill` project is a collection. Init seeds one skill and its spec,
but the project's real life is adding more. Each new skill needs the same
parts: `skills/<name>/SKILL.md`, a spec in `specs/<name>.md` in the
agent-skills-toolkit style, optionally an evaluation suite, and the project's
checks to pick it up. Drop Calf must decide who creates those parts and what
it injects into the project to make that possible.

## Current state

- `skill:new` runs the toolkit's `init-skill <name>`. It creates
  `skills/<name>/` with `SKILL.md` and empty `scripts/`, `assets/`,
  `references/`, and `evals/` directories. It does not create a spec or
  seed an evaluation suite (`init-skill-eval` is a separate command).
- The starter skill and spec come from `templates/skill-starter`. Nothing
  reuses them for later skills, so the toolkit's SKILL.md body and the starter
  body can drift apart.
- `skill:new` depends on installing the toolkit CLIs, which spec 05 shows is
  not yet true.
- Drop Calf has three verbs (init, update, validate) that act on a whole
  project. None adds a child to an existing project.

## Options

1. **Toolkit owns creation.** Extend `init-skill` to create the spec and, with
   a flag, the eval suite. Drop Calf changes nothing. Cheapest, but the spec
   template lives in the toolkit and the project cannot customize it.
2. **Drop Calf injects a generator.** Init seeds `src/scripts/new-skill.ts`
   and a template tree (for example `templates/skill/`) that the script copies
   and renames. `skill:new` points at it. The project is self-sufficient,
   owners can edit the template, and Drop Calf can refresh the generator on
   `update` if it is policy-managed rather than owner-managed.
3. **A fourth Drop Calf verb, `add`.** `dagger call add-skill --name ...`
   writes the new skill into the exported project. Keeps all templates in
   Drop Calf, but every new skill needs a module call, and the project cannot
   create children offline.

Option 2 fits how the starter already works: its script and test are a
working example of project-local tooling under `src/scripts/` and
`tests/scripts/`.

## Questions option 2 raises

- **Template source.** Does the generator copy a dedicated template tree, or
  copy `skills/example-skill` itself? Copying the example keeps one source but
  makes deleting or editing the example a breaking change.
- **Ownership.** Is the generator init-only like other seeded sources, or kept
  fresh by `update` like policy-managed scripts? If fresh, owner edits to it
  need a merge rule.
- **Shared rules.** The toolkit validates skill names and frontmatter. The
  generator must apply the same rules; calling `check-skill` after creating
  the skill would enforce that without duplicating them.
- **Evals.** Does the generator also create `evals/promptfooconfig.yaml`
  (the toolkit's per-skill layout), and how does the `evals` capability's
  root-level Promptfoo tree relate to per-skill suites? That capability's
  templates are written for a Forge Rovo agent today.
- **Registration.** Adding a skill may need project config changes (the
  toolkit uses per-skill spelling dictionaries, which spec 01 declines to
  generalize). Does anything else need injecting per skill?
- **Naming.** Is `skill:new` the stable script name, and does it stay
  stable if the implementation moves from the toolkit to a local script?

## Generalization

Other kinds may also be collections whose children follow a template (Forge
modules in a `forge-app`, for instance). Decide whether "a capability can
seed a child generator" becomes a general Drop Calf concept, with a documented
shape, or stays specific to `agent-skill` until a second kind needs it.

## Open decisions

1. Option 1, 2, or 3, informed by spec 05's decision on installing the toolkit.
2. Template source and ownership for option 2.
3. Whether per-skill evals are part of "new skill" or a second step.
4. Whether this stays `agent-skill`-specific or defines a general pattern.
