import { type Capability, noOp } from "../core/capability.ts";
import type {
  PackageManager,
  PackageManagerOption,
} from "../core/package-manager.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

const parallelCommand = (manager: PackageManager, tasks: string) =>
  `run-p --npm-path ${manager} --print-label "${tasks}"`;

export const LINT_COMMAND = parallelCommand("npm", "lint:check:*");
export const CHECK_COMMAND = parallelCommand(
  "npm",
  "{lint,test,size:check,pack:check}",
);

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
            "Runs lint:check:* scripts and the lint/test/size/package check workflow in parallel, independently of Git hooks.",
        },
      ],
    },
    packageJson: {
      seed: { devDependencies: { "npm-run-all2": TOOL_VERSIONS.npmRunAll2 } },
      policy: {
        scripts: {
          lint: parallelCommand(packageManager, "lint:check:*"),
          check: parallelCommand(
            packageManager,
            "{lint,test,size:check,pack:check}",
          ),
        },
      },
    },
    init: noOp(
      "Lint owns no files; its package.json contribution seeds npm-run-all2 and supplies the lint and check aggregates.",
    ),
    update: noOp(
      "Lint owns no files; its package.json contribution enforces the lint and check aggregates and keeps the seeded runner fresh.",
    ),
    validate: noOp(
      "Lint has no configuration file; source checks belong to the lint workflow, not capability validation.",
    ),
  };
}
