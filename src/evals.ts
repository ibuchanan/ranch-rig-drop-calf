import type { Capability } from "./capabilities.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const EVALS_TEMPLATE = "templates/promptfoo";

export function evals(): Capability {
  return {
    templates: [EVALS_TEMPLATE],
    addTo(project) {
      project.packageJson.scripts.eval = "promptfoo eval";
      project.packageJson.scripts.view = "promptfoo view";
      project.packageJson.devDependencies.promptfoo = TOOL_VERSIONS.promptfoo;
    },
  };
}
