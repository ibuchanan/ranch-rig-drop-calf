import { type Capability, noOp } from "../core/capability.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

/** The toolkit ships the skill CLIs; this repository only wires them into its scripts. */
export const SKILL_TOOLKIT_PACKAGE = "agent-skills-toolkit";
export const SKILL_TOOLKIT_SCRIPTS = {
  "lint:check:skills": "check-skill --all",
  "skill:new": "init-skill",
} as const;

export function skillToolkit(): Capability {
  return {
    name: "skill-toolkit",
    documentation: {
      tools: [
        {
          name: "agent-skills-toolkit",
          url: "https://github.com/ibuchanan/agent-skills-toolkit",
          purpose:
            "Scaffolds skills under skills/ and checks SKILL.md frontmatter, references, and prompts.",
        },
      ],
    },
    // Lint owns the aggregate; skill checks join it as a producer.
    packageJson: {
      seed: {
        devDependencies: {
          [SKILL_TOOLKIT_PACKAGE]: TOOL_VERSIONS.agentSkillsToolkit,
        },
      },
      policy: { scripts: SKILL_TOOLKIT_SCRIPTS },
    },
    init: noOp(
      "Skill toolkit owns no files; skills are created with skill:new, and its package.json contribution supplies the toolkit dependency and scripts.",
    ),
    update: noOp(
      "Skill toolkit owns no files; its package.json contribution enforces the skill scripts, and the toolkit GitHub reference is owner-managed.",
    ),
    validate: noOp(
      "Skill toolkit has no repository-local configuration to validate; skill checks belong to the lint workflow, not capability validation.",
    ),
  };
}
