import type { ProjectBlueprint } from "./project.ts";
import { type Capability, noOp } from "./capability.ts";

// Authored guidance seed: keep this aligned with the generated Forge scripts.
// Non-Forge kinds intentionally omit it rather than inherit Forge-only instructions.
const FORGE_GUIDANCE = `# Agent guidance

This repository is an Atlassian Forge app. Read \`manifest.yml\` before
changing modules, functions, scopes, or external permissions. Prefer
Forge's built-in authentication and storage to custom services; check
authorization when using app-level access.

Before submitting changes, run \`npm run lint\`, \`npm run format:check\`,
\`npm run typecheck\`, and \`npm run test\`. Review scope or egress changes before
deploying; do not deploy or install without approval.
`;

export function aidev(profile: string): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    if (profile === "forge-app") project.files.set("AGENTS.md", FORGE_GUIDANCE);
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
      ...(profile === "forge-app"
        ? { init: "Seed authored Forge agent guidance in AGENTS.md." }
        : {}),
    },
    ...(profile === "forge-app"
      ? { selection: { without: true, default: true } }
      : {}),
    init:
      profile === "forge-app"
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
