import { type Capability, noOp } from "../core/capability.ts";
import type {
  PackageManager,
  PackageManagerOption,
} from "../core/package-manager.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

const lintCommand = (manager: PackageManager) =>
  `run-p --npm-path ${manager} --print-label "lint:check:*"`;

export const LINT_COMMAND = lintCommand("npm");

export function lint({
  packageManager = "npm",
}: PackageManagerOption = {}): Capability {
  return {
    name: "lint",
    documentation: {
      tools: [
        {
          name: "npm-run-all2",
          url: "https://github.com/bcomnes/npm-run-all2",
          purpose:
            "Runs producer-owned lint:check:* scripts in parallel, independently of Git hooks.",
        },
      ],
    },
    packageJson: {
      seed: { devDependencies: { "npm-run-all2": TOOL_VERSIONS.npmRunAll2 } },
      policy: {
        scripts: { lint: lintCommand(packageManager) },
      },
    },
    init: noOp(
      "Lint owns no files; its package.json contribution seeds npm-run-all2 and supplies the lint aggregate.",
    ),
    update: noOp(
      "Lint owns no files; its package.json contribution enforces the lint aggregate and keeps the seeded runner fresh.",
    ),
    validate: noOp(
      "Lint has no configuration file; source checks belong to the lint workflow, not capability validation.",
    ),
  };
}
