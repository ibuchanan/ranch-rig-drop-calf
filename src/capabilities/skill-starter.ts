import { type Capability, noOp } from "../core/capability.ts";
import { templateTree } from "../core/templates.ts";

export const SKILL_STARTER_TEMPLATE = "templates/skill-starter";
export const SKILL_STARTER_SCRIPTS = {
  "skill:list": "bun run src/scripts/list-skills.ts",
} as const;

export function skillStarter(): Capability {
  return {
    name: "skill-starter",
    documentation: {
      tools: [
        {
          name: "Agent Skills",
          url: "https://agentskills.io/",
          purpose:
            "Defines the SKILL.md package format that the starter skill, its spec, and the scripts follow.",
        },
      ],
      init: "Seed src/scripts with one Bun script, its test, the first skill under skills/, and that skill's spec in the agent-skills-toolkit style.",
    },
    packageJson: { seed: { scripts: SKILL_STARTER_SCRIPTS } },
    init(project) {
      project.templates.push(templateTree(SKILL_STARTER_TEMPLATE));
    },
    update: noOp(
      "Skills, specs, scripts, and tests are owner-managed after init, including deletions; update never restores the starter skill.",
    ),
    validate: noOp(
      "Skill structure is checked by the lint:check:skills producer from skill-toolkit, not by capability validation.",
    ),
  };
}
