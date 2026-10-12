import { type Capability, noOp } from "./capability.ts";
import { TOOL_VERSIONS } from "./versions.ts";

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
