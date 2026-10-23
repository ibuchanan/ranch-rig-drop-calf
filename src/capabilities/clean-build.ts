import { type Capability, noOp } from "../core/capability.ts";

export function cleanBuild({ reinstall = false } = {}): Capability {
  const command = reinstall
    ? "rm -rf node_modules package-lock.json dist"
    : "rm -rf dist";
  return {
    name: "clean-build",
    documentation: {
      tools: [
        {
          name: "rm",
          url: "https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html",
          purpose: reinstall
            ? "Removes node_modules, package-lock.json, and dist when the owner runs the clean workflow."
            : "Removes dist when the owner runs the clean workflow.",
        },
      ],
    },
    packageJson: { policy: { scripts: { clean: command } } },
    init: noOp(
      "Clean build owns no files to seed; its package.json contribution supplies the clean script.",
    ),
    update: noOp(
      `Clean build owns no files; its package.json contribution enforces scripts.clean as ${command} and never executes it.`,
    ),
    validate: noOp(
      "Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow.",
    ),
  };
}
