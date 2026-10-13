import { type Capability, noOp } from "./capability.ts";
import { templateTree } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const FALLOW_TEMPLATE = "templates/fallow";
export const FALLOW_SCRIPT = "fallow --fail-on-issues";

export function fallow(): Capability {
  return {
    name: "fallow",
    documentation: {
      tools: [
        {
          name: "Fallow",
          url: "https://docs.fallow.tools/",
          purpose:
            "Checks unused code, dependencies, duplication, and complexity.",
        },
      ],
      init: "Seed Fallow, lint:fallow, and an owner-managed config for tool and library projects.",
    },
    selection: { without: true, default: true },
    packageJson: {
      seed: { devDependencies: { fallow: TOOL_VERSIONS.fallow } },
      policy: { scripts: { "lint:fallow": FALLOW_SCRIPT } },
    },
    init(project) {
      project.templates.push(templateTree(FALLOW_TEMPLATE));
    },
    update: noOp(
      "Fallow config is owner-managed after init, including deletion; its package.json contribution enforces lint:fallow and keeps the seeded dependency fresh.",
    ),
    validate: noOp(
      "Fallow has no configuration-only check; source analysis belongs to lint:fallow, not capability validation.",
    ),
  };
}
