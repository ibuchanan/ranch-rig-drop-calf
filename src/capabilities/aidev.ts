import { type Capability, noOp } from "../core/capability.ts";
import type { ProjectBlueprint } from "../core/project.ts";
import { EVALS_TEMPLATE, templateTree } from "../core/templates.ts";

export const AIDEV_TEMPLATE = "templates/aidev";

export type AidevOptions = {
  /** Seed the authored Forge guidance; without it there is nothing to seed. */
  forgeGuidance?: boolean;
};

export function aidev({
  forgeGuidance = false,
}: AidevOptions = {}): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.templates.push(
      templateTree(AIDEV_TEMPLATE, async (destination, source) => {
        const guidance = await source.file("AGENTS.md").contents();
        const evalsSelected = project.templates.some(
          (template) => template.path === EVALS_TEMPLATE,
        );
        return destination.withNewFile(
          "AGENTS.md",
          guidance +
            (evalsSelected ? await source.file("evals.md").contents() : ""),
        );
      }),
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
