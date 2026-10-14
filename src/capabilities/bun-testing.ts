import { type Capability, noOp } from "../core/capability.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export const BUN_TEST_SCRIPTS = {
  test: "bun test --pass-with-no-tests",
  "test:watch": "bun test --watch --pass-with-no-tests",
  "test:coverage": "bun test --coverage --pass-with-no-tests",
} as const;

export function bunTesting(): Capability {
  return {
    name: "test",
    documentation: {
      tools: [
        {
          name: "Bun test",
          url: "https://bun.com/docs/test",
          purpose:
            "Runs library, tool, and agent-skill tests with built-in watch and coverage support.",
        },
      ],
    },
    packageJson: {
      seed: { devDependencies: { "@types/bun": TOOL_VERSIONS.bun } },
      policy: { scripts: BUN_TEST_SCRIPTS },
    },
    init: noOp(
      "Seed @types/bun for test typechecking and supply test scripts; test sources remain owner-managed.",
    ),
    update: noOp(
      "Bun testing owns no files; its package.json contribution enforces test scripts and keeps @types/bun fresh, preserving owner test sources.",
    ),
    validate: noOp(
      "This capability owns no Bun test configuration to validate. Test execution belongs to the test workflow; comparing scripts to defaults would check policy, not tool acceptance.",
    ),
  };
}
