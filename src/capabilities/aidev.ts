import { type Capability, noOp } from "../core/capability.ts";
import type { ProjectBlueprint } from "../core/project.ts";
import { EVALS_TEMPLATE, templateTree } from "../core/templates.ts";

export const AIDEV_TEMPLATE = "templates/aidev/forge-app";
export const LIBRARY_AIDEV_TEMPLATE = "templates/aidev/library";

export type AidevOptions = {
  /** Authored template tree path; omit when no guidance should be seeded. */
  guidance?: string;
};

export function aidev({ guidance }: AidevOptions = {}): Capability {
  const seed = (project: ProjectBlueprint) => {
    project.templates.push(
      templateTree(guidance ?? AIDEV_TEMPLATE, async (destination, source) => {
        const text = await source.file("AGENTS.md").contents();
        const evalsSelected =
          project.templates.some(
            (template) => template.path === EVALS_TEMPLATE,
          ) && (await source.exists("evals.md"));
        return destination.withNewFile(
          "AGENTS.md",
          text +
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
      ...(guidance
        ? {
            init: `Seed authored agent guidance from ${guidance} in AGENTS.md.`,
          }
        : {}),
    },
    ...(guidance ? { selection: { without: true, default: true } } : {}),
    init: guidance
      ? seed
      : noOp("No authored agent guidance is selected for this project kind."),
    update: noOp(
      "Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md.",
    ),
    validate: noOp(
      "AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance.",
    ),
  };
}
