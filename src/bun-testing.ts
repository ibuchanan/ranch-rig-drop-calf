import { type Capability, noOp } from "./capability.ts";

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
    packageJson: { policy: { scripts: BUN_TEST_SCRIPTS } },
    init: noOp(
      "Bun's built-in test runner needs no dependency or configuration seed; its package.json contribution supplies the test scripts, and test sources are owner-managed.",
    ),
    update: noOp(
      "Bun testing owns no files; its package.json contribution enforces the test/watch/coverage scripts, preserving owner test sources.",
    ),
    validate: noOp(
      "This capability owns no Bun test configuration to validate. Test execution belongs to the test workflow; comparing scripts to defaults would check policy, not tool acceptance.",
    ),
  };
}
