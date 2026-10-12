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
  const seed: Capability["addTo"] = (project) => {
    if (profile === "forge-app") project.files.set("AGENTS.md", FORGE_GUIDANCE);
  };
  return {
    name: "aidev",
    // Retain the legacy contribution until ticket 26 contracts the old shape.
    addTo: seed,
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
