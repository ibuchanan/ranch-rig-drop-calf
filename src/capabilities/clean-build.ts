import { type Capability, noOp } from "../core/capability.ts";

const CLEAN_BUILD_COMMAND = "rm -rf dist";

export function cleanBuild(): Capability {
  return {
    name: "clean-build",
    documentation: {
      tools: [
        {
          name: "rm",
          url: "https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html",
          purpose: "Removes dist when the owner runs the clean workflow.",
        },
      ],
    },
    packageJson: { policy: { scripts: { clean: CLEAN_BUILD_COMMAND } } },
    init: noOp(
      "Clean build owns no files to seed; its package.json contribution supplies the clean script.",
    ),
    update: noOp(
      "Clean build owns no files; its package.json contribution enforces scripts.clean as rm -rf dist and never executes it.",
    ),
    validate: noOp(
      "Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow.",
    ),
  };
}
