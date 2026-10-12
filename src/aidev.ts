import { type Capability, noOp } from "./capability.ts";
import { EVALS_TEMPLATE } from "./evals.ts";
import type { ProjectBlueprint } from "./project.ts";

// Authored seed, not a maintained block. References are checked against init output.
const FORGE_GUIDANCE = `# Agent guidance

This repository is an Atlassian Forge app.

## Platform boundaries

- Read \`manifest.yml\` before changing modules, function handlers, resources,
  scopes, or external permissions. Keep code and manifest wiring aligned.
- Backend functions are invocation-scoped, not persistent servers. Persist
  state in Forge storage; use async events for work beyond an invocation.
- Preserve the app's UI Kit or Custom UI model. Use Forge Bridge/resolvers
  for frontend-to-backend calls; do not assume a public backend URL.
  Web triggers and remotes require explicit manifest wiring.
- Declare external network access in the manifest; do not assume unrestricted
  egress.
- Prefer \`asUser()\` for user-driven product API calls. Use \`asApp()\` only when
  app-level access is needed, and enforce caller authorization for
  user-triggered operations.

## Checks and operations

- Before submitting changes, run \`npm run check\`.
- Use \`npm run typecheck\` and \`npm run test\` for focused feedback.
  The Forge test runner is Vitest.
- Run \`npm run lint:forge\` after manifest changes.
- Use the generated \`forge:*\` scripts from the repository root. They supply
  SecretSpec targeting values and command-specific flags; do not bypass them
  or copy flags between CLI commands.
- Do not register, deploy, install, upgrade, or uninstall without approval.
  Registration creates a new app identity; it is not routine maintenance.
- After scope or egress changes, use \`npm run forge:deploy\`, followed by
  \`npm run forge:upgrade\` for existing installations, with approval.
- Tunnels target development only and redirect invocations to your machine.
  Inspect deployed backend invocation logs for backend failures; frontend
  logs are in the browser console.
`;

const EVALS_GUIDANCE = `
## Prompt evaluations

<!-- cspell:words rovo -->

- For prompt changes, use \`npm run eval\` and inspect results with
  \`npm run view\`. Evaluations call the configured model provider and may
  incur charges; use approved data and obtain approval before running them.
- Prompt evaluations do not replace deployed Rovo integration tests.
`;

export type AidevOptions = {
  /** Seed the authored Forge guidance; without it there is nothing to seed. */
  forgeGuidance?: boolean;
};

export function aidev({
  forgeGuidance = false,
}: AidevOptions = {}): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    const evalsSelected = project.templates.some(
      (template) => template.path === EVALS_TEMPLATE,
    );
    project.files.set(
      "AGENTS.md",
      FORGE_GUIDANCE + (evalsSelected ? EVALS_GUIDANCE : ""),
    );
  };
  return {
    name: "aidev",
    documentation: {
      tools: [
        {
          name: "AGENTS.md",
          url: "https://agents.md/",
          purpose:
            "Gives coding agents repository-specific instructions; human guidance, not executable config.",
        },
      ],
      ...(forgeGuidance
        ? { init: "Seed authored Forge agent guidance in AGENTS.md." }
        : {}),
    },
    ...(forgeGuidance ? { selection: { without: true, default: true } } : {}),
    init: forgeGuidance
      ? seed
      : noOp(
          "Only Forge apps have an authored agent guidance seed; other project kinds omit Forge-specific instructions.",
        ),
    update: noOp(
      "Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md.",
    ),
    validate: noOp(
      "AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance.",
    ),
  };
}
