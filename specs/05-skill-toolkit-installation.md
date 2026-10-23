# Installing agent-skills-toolkit into agent-skill projects

Status: **draft, open decisions**. This spec does not change the current
capability contract in [`02-project-functions.md`](02-project-functions.md).

## Problem

`agent-skill` projects depend on
[`agent-skills-toolkit`](https://github.com/ibuchanan/agent-skills-toolkit)
for two things: command-line tools (`check-skill`, `init-skill`, and the
validators behind them) and, in the toolkit's own repository, a set of skills
that help an agent author other skills. Drop Calf must decide what "installed"
means for each, who owns the result, and how it stays fresh.

## Current state

The `skill-toolkit` capability seeds `agent-skills-toolkit` as a dev dependency
pinned to `github:ibuchanan/agent-skills-toolkit` and contributes two scripts:
`lint:check:skills` (`check-skill --all`) and `skill:new` (`init-skill`).

Checked against the toolkit repository, that wiring cannot work yet:
- The toolkit's `package.json` has no `bin` field, so installing it links no
  `check-skill` or `init-skill` into `node_modules/.bin`.
- The executables the toolkit documents are build output in `/scripts/`, which
  its `.gitignore` excludes. A dependency fetched from GitHub does not contain
  them.
- The toolkit is `private: true`, and its `prepare` script builds a vendored
  submodule (`bootstrap`) and installs Lefthook. Those are repository
  concerns that would run on every consumer's install.
- The GitHub reference carries no commit or tag, so pin refreshes cannot be
  reviewed as a version change.
- Its technical spec names an `install-skills` script, and a test for it
  exists, but `src/scripts/` has no such script.

## Distribution of skills is a separate question

Skills are distributed by a skills-specific tool chain (the `skills` CLI),
not by the npm install of a library. Two distinct needs follow:
- **Tooling for authors** (the CLIs) is a dev dependency of an `agent-skill`
  repository, so npm or Git-ref distribution is reasonable for it.
- **The skills themselves**, for the toolkit's own authoring skills and for
  every skill an `agent-skill` repository publishes, are installed by the
  skills tool chain. A repository's `skills/<name>/` layout must therefore be
  compatible with it.

### Experiment record

Run on 2026-10-22 with `skills` 1.7.4, invoked through `npx` (the `agent-skill`
kind itself uses Bun, so seeded scripts use `bun`/`bunx`) against the toolkit at commit
`d44a370` and an empty wrangler project (`ranch-hand-skill-wrangler`).
- `skills add ibuchanan/agent-skills-toolkit --list` found all five toolkit
  skills from their `skills/<name>/SKILL.md` layout, with descriptions. No
  toolkit change was needed for discovery.
- **Route A, `skills add --skill grill-this-skill --agent claude-code`:**
  copied the skill into `.claude/skills/` only (no `.agents/`), and wrote
  `skills-lock.json` with source, path, and content hash but no revision.
  After `skills remove`, an empty lockfile remained.
- **Route B, a `skills` field in `package.json` plus
  `skills experimental_sync -a claude-code -y`:** the entry may be a string
  (`owner/repo@skill` selects one skill) or an object
  (`{ "source", "skills": [...], "ref" }`). With a full commit hash as `ref`
  it installed only the named skill into `.agents/skills/`, linked it from
  `.claude/skills/` with a relative symlink, and recorded the `ref` in
  `skills-lock.json`. The content hash matched route A, so both routes
  install the same bytes.
- Installed directories omit the toolkit's empty `references/`, `scripts/`,
  `assets/`, and `evals/tests/` directories; Git does not store them.
- The sync command is marked experimental in the CLI, and its dry run does not
  print the skill filter or the ref, so only a real run confirms them.

Route B is the better fit: the declaration is a reviewable `package.json`
change, a revision can be pinned, and the layout is the shared
`.agents/skills/` directory with an agent link on top.

### What still breaks

The delivery works, but the content is not yet self-contained. The installed
skills assume the toolkit repository around them:
- `develop-skill-evals` reads `specs/references/agent-skills/skill-format.md`
  and `specs/references/prompt-engineering/skill-composition.md`, and runs
  `scripts/init-skill-eval`.
- `grill-this-skill` reads `specs/references/`, and its own `references/`
  directory is empty.
- `describe-skill`, `grill-this-skill`, and `develop-skill-evals` expect
  `specs/<skill-name>.md`. The `skill-starter` capability seeds that layout, so
  this expectation holds in generated projects.

## Scope of "installed"

| Artifact                                                          | Consumer need                                                 | Candidate home                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| CLIs (`check-skill`, `init-skill`, `validate-*`)                  | On `PATH` for package scripts and hooks                       | Dependency with `bin` entries                              |
| Authoring skills (`develop-skill-evals`, `grill-this-skill`, ...) | Discoverable by the agent while working in the project        | `.agents/skills/` or `.claude/skills/` in the consumer     |
| Spell-check vocabulary the toolkit's checks need                  | `check-skill` runs `cspell` and rejects words such as `evals` | Consumer cspell config, or the toolkit's own               |
| `bunfig.toml` test exclusions, `vendor/`                          | Only the toolkit's own repository                             | Not installed; spec 01 already declines to generalize them |

## Options

### CLIs

1. **Toolkit publishes `bin` entries that point at its TypeScript sources.**
   Its entry points already start with `#!/usr/bin/env bun`, so no build is
   needed and Bun links them on install. Needs a toolkit change: add `bin`,
   drop the consumer-visible `prepare` work, stop being `private` (or keep it
   private and depend by Git ref).
2. **Toolkit ships compiled binaries as release assets.** Matches its
   documented "no runtime required" distribution, but a consumer then needs a
   download step and a checksum pin, which Drop Calf has no precedent for.
3. **Drop Calf seeds the scripts into each project.** The project owns copies
   and can edit them, but every toolkit fix needs an update verb to
   reconcile owner edits. This is the heaviest option.

### Authoring skills

1. **Declare them in `package.json` and sync** (route B). The capability seeds
   a `skills` entry with a pinned `ref` and a script that runs
   `skills experimental_sync -y`; the sync tool is a dev dependency. Drop Calf
   holds no skill content.
2. **Install imperatively with `skills add`** (route A). Works, but the
   choice lives in shell history and the lock records no revision.
3. **Drop Calf seeds them at init** from a pinned copy. Fresh at creation, then
   owner-managed, like AGENTS.md. Drop Calf would own content that belongs to
   the toolkit.
4. **Not installed.** Projects use the toolkit's skills from the agent's
   global skill directory.

## Recommendation (to confirm)

- **Authoring skills: option 1.** The `skill-toolkit` capability seeds the
  `skills` entry in object form, with `source`, a `skills` list, and `ref` set
  to a toolkit commit or tag, and enforces a sync script. It remains
  file-free and uses the existing `package.json` seed and policy machinery.
  Refreshing the pin is a normal pin bump in `pins/package.json`.
- **The sync script is `skill:sync`**, defined as `skills experimental_sync -y`
  with `skills` as a dev dependency, run through Bun like every other
  `agent-skill` script (`bun run skill:sync`; `bunx skills ...` until the
  dependency is seeded). It sits beside `skill:new` and
  `skill:list` so the whole skill workflow is discoverable with `bun run`.
  Pass an agent through the script (`bun run skill:sync -a claude-code`);
  without `-a` the CLI detects installed agents, or targets the current one
  when run inside a coding agent. Preview with `bun run skill:sync --dry-run`.
  It runs on demand, not from `prepare`, so a routine install does not fetch
  from the network while the command is experimental.
- **Document the workflow where the owner will look.** The `agent-skill`
  `AGENTS.md` and `DEVELOPMENT.md` name `skill:sync`: run it after cloning, and
  after changing the `skills` entry or its `ref`.
- **CLIs: option 1.** The toolkit publishes `bin` entries that point at its
  TypeScript sources. This is also the smallest change. If the `npm:` source is
  used in the `skills` field, one toolkit dependency can deliver both the CLIs
  and the skills.
- **Before either is useful**, the toolkit's skills must be made
  self-contained: move the reference material they rely on into each skill's
  own `references/`, and make the CLI calls resolvable. Drop Calf cannot make
  those changes.

## Open decisions

1. Is the toolkit referenced by Git commit or tag, or published to npm and
   used through the `npm:` source? Either way the pin needs a version Drop Calf
   can refresh and test.
2. The sync command is experimental. Accept that risk, or fall back to route A
   in a seeded script until it stabilizes? Also confirm whether a lockfile with
   no installed skills should be committed.
3. Should `skill:sync` also run from `prepare` once the command is no longer
   experimental? The CLI documents that pattern, but it makes every install
   depend on the network.
4. Which of the toolkit's tools are the public interface? Adopt a list, and
   keep `skill:new` and `lint:check:skills` as the stable script names (spec 01
   forbids per-kind script names for developer workflows).
5. Which skills does a new `agent-skill` project install by default? The
   starter skill depends on none of them, so the default can be empty.
6. How do the toolkit's skills become self-contained, and do their
   `specs/references/` pointers move into each skill or become optional?
7. ~~Whose cspell configuration does `check-skill` use?~~ Resolved: it runs
   `cspell` from the repository root, so the consumer's own configuration
   applies. Unknown words are fixed by editing that configuration; the starter
   skill avoids `evals` only so a fresh project passes. Automating the
   "add this word" step is optional convenience, not a requirement.
8. How does the toolkit's `CITATION.cff` check (`validate-cff`) relate to the
   `citation` capability's no-op validate?
9. Should `skill-toolkit` validate become real, for example confirming the
   `skills` entry parses and the `bin` entries resolve, once installation is
   defined?
