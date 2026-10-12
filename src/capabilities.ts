import { biomeToolchain } from "./biome.ts";
import { type Capability, noOp } from "./capability.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export type { Capability } from "./capability.ts";
export { docsLinting } from "./docs.ts";
export { biomeToolchain };

export function forgeAhead(): Capability {
  return {
    name: "forge-ahead",
    documentation: {
      tools: [
        {
          name: "Forge Ahead API types",
          url: "https://github.com/ibuchanan/forge-ahead-atlassian-api-types",
          purpose:
            "Provides types for Atlassian API integration in Forge apps.",
        },
        {
          name: "Forge Ahead errors",
          url: "https://github.com/ibuchanan/forge-ahead-errors",
          purpose: "Provides typed error handling at Forge boundaries.",
        },
        {
          name: "Forge Ahead logging",
          url: "https://github.com/ibuchanan/forge-ahead-logging",
          purpose: "Provides logging helpers for Forge apps.",
        },
      ],
    },
    packageJson: {
      seed: {
        dependencies: {
          "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
          "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
          "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
        },
      },
    },
    init: noOp(
      "Forge Ahead owns no files; its package.json contribution seeds the API types, errors, and logging dependencies.",
    ),
    update: noOp(
      "Forge Ahead owns no files; its seeded dependencies are owner-managed and kept fresh against their pins, which skips GitHub references.",
    ),
    validate: noOp(
      "Forge Ahead dependencies have no repository-local configuration to validate; comparing dependency references would check policy, not tool acceptance. Runtime integration belongs to the app's build and test workflows.",
    ),
  };
}

export { libraryBuild } from "./library-build.ts";

export const CLEAN_BUILD_COMMAND = "rm -rf dist";

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

export { vitestTesting } from "./vitest.ts";
