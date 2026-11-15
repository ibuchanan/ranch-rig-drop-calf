import { type Capability, noOp } from "../core/capability.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export function skills(): Capability {
  return {
    name: "skills",
    documentation: {
      tools: [
        {
          name: "agent-skills-toolkit",
          url: "https://github.com/ibuchanan/agent-skills-toolkit",
          purpose: "Links skills from installed packages with link-skills.",
        },
        {
          name: "skill-wrangler",
          url: "https://github.com/ibuchanan/ranch-hand-skill-wrangler",
          purpose: "Supplies skills linked into the project during prepare.",
        },
      ],
    },
    packageJson: {
      seed: {
        devDependencies: {
          "agent-skills-toolkit": TOOL_VERSIONS.agentSkillsToolkit,
          "skill-wrangler": TOOL_VERSIONS.skillWrangler,
        },
      },
      policy: {
        scripts: {
          "skill:link-wrangler": "link-skills --package skill-wrangler",
        },
      },
    },
    init: noOp(
      "Skills owns no files; its package.json contribution seeds the toolkit and skill package and supplies the linking script.",
    ),
    update: noOp(
      "Skills owns no files; its package.json contribution enforces the linking script, while GitHub dependency references remain owner-managed.",
    ),
    validate: noOp(
      "Skills has no repository-local configuration to validate; linking runs during prepare, not capability validation.",
    ),
  };
}
