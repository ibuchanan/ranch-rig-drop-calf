import { biomeToolchain } from "./biome.ts";
import { type Capability, expandCapability, noOp } from "./capability.ts";
export { docsLinting } from "./docs.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export type { Capability } from "./capability.ts";
export { biomeToolchain };

export function forgeAhead(): Capability {
  return expandCapability("forge-ahead", "18-forge-ahead", {
    addTo(project) {
      project.packageJson.dependencies = {
        "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
        "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
        "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
      };
    },
  });
}

export function libraryBuild(version = TOOL_VERSIONS.tsdown): Capability {
  return expandCapability("library-build", "12-library-build", {
    addTo(project) {
      project.packageJson.scripts.build = "tsdown";
      project.packageJson.devDependencies.tsdown = version;
      project.files.set(
        "tsdown.config.ts",
        'import { defineConfig } from "tsdown";\n\nexport default defineConfig({ entry: ["src/index.ts"], outDir: "dist", format: ["esm"], dts: true });\n',
      );
      project.packageJson.main = "./dist/index.js";
      project.packageJson.types = "./dist/index.d.ts";
      project.packageJson.exports = {
        ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
      };
    },
  });
}

export function cleanBuild(): Capability {
  return expandCapability("clean-build", "13-clean-build", {
    addTo(project) {
      project.packageJson.scripts.clean = "rm -rf dist";
    },
  });
}

export function bunTesting(): Capability {
  return expandCapability("test", "11-testing-non-forge", {
    addTo(project) {
      project.packageJson.scripts.test = "bun test --pass-with-no-tests";
      project.packageJson.scripts["test:watch"] =
        "bun test --watch --pass-with-no-tests";
      project.packageJson.scripts["test:coverage"] =
        "bun test --coverage --pass-with-no-tests";
    },
  });
}

export { vitestTesting } from "./vitest.ts";

export function noTesting(): Capability {
  return {
    ...expandCapability("test", "11-testing-non-forge", { addTo() {} }),
    init: noOp("The agent-skill profile does not seed a test runner."),
  };
}
