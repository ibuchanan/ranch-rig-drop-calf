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

An npm package is not the well-known path for sharing agent skills. That path
is a skills-specific tool chain (`npx skills add ...`), which installs skill
directories rather than packages. Two distinct needs follow:

- **Tooling for authors** (the CLIs) is a dev dependency of an `agent-skill`
  repository, so npm or Git-ref distribution is reasonable for it.
- **The skills themselves**, for the toolkit's own authoring skills and for
  every skill an `agent-skill` repository publishes, should be installable by
  consumers with the skills tool chain. A repository's `skills/<name>/`
  layout must therefore be compatible with it.

How `agent-skill` repositories in general publish and install skills is not
settled. The toolkit is the first real case: run the tool chain against it and
the repositories generated from this kind, record what breaks, and only then
fix a layout and any publishing script Drop Calf seeds.

## Scope of "installed"

| Artifact | Consumer need | Candidate home |
|---|---|---|
| CLIs (`check-skill`, `init-skill`, `validate-*`) | On `PATH` for package scripts and hooks | Dependency with `bin` entries |
| Authoring skills (`develop-skill-evals`, `grill-this-skill`, ...) | Discoverable by the agent while working in the project | `.agents/skills/` or `.claude/skills/` in the consumer |
| Spell-check vocabulary the toolkit's checks need | `check-skill` runs `cspell` and rejects words such as `evals` | Consumer cspell config, or the toolkit's own |
| `bunfig.toml` test exclusions, `vendor/` | Only the toolkit's own repository | Not installed; spec 01 already declines to generalize them |

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

1. **A toolkit command copies them in** (the unimplemented `install-skills`),
   run by the owner or by a `prepare`-style script. Drop Calf only wires the
   script.
2. **Drop Calf seeds them at init** from a pinned copy. Fresh at creation, then
   owner-managed, like AGENTS.md.
3. **Not installed.** Projects reference the toolkit's skills from the
   agent's global skill directory.

## Recommendation (to confirm)

CLIs: option 1. It is the smallest change and keeps Drop Calf's
`skill-toolkit` capability file-free, as it is today. Authoring skills: option
1, so one tool owns the layout and Drop Calf only supplies the dependency and
the script. Both depend on toolkit changes that Drop Calf cannot make.

## Open decisions

1. Is the toolkit published (npm or a Git tag) or consumed by Git ref? Either
   way the pin needs a version Drop Calf can refresh and test.
2. Which experiment repositories exercise the skills tool chain first, and
   what do they need to pass? Also: which of the toolkit's tools are the public
   interface? Adopt a list, and
   keep `skill:new` and `lint:check:skills` as the stable script names (spec 01
   forbids per-kind script names for developer workflows).
3. Where do installed authoring skills live, `.agents/skills/` or
   `.claude/skills/`, and does `update` ever refresh them?
4. ~~Whose cspell configuration does `check-skill` use?~~ Resolved: it runs
   `cspell` from the repository root, so the consumer's own configuration
   applies. Unknown words are fixed by editing that configuration; the starter
   skill avoids `evals` only so a fresh project passes. Automating the
   "add this word" step is optional convenience, not a requirement.
5. How does the toolkit's `CITATION.cff` check (`validate-cff`) relate to the
   `citation` capability's no-op validate?
6. Should `skill-toolkit` validate become real, for example confirming the
   `bin` entries resolve, once installation is defined?
