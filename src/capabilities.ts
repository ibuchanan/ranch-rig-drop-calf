import { biomeToolchain } from "./biome.ts";
import { type Capability, expandCapability, noOp } from "./capability.ts";
import { DOCS_TEMPLATE } from "./docs.ts";
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

/**
 * Lint the seeded documentation tree. The tool config is pinned in
 * `templates/docs` alongside the Markdown it checks; the capability declares
 * that tree with the runner so selecting it also seeds the tools' inputs.
 */
export function docsLinting(): Capability {
  return expandCapability("docs", "20-docs", {
    templates: [DOCS_TEMPLATE],
    addTo(project) {
      project.packageJson.scripts["lint:docs"] =
        'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"';
      project.packageJson.devDependencies.cspell = TOOL_VERSIONS.cspell;
      project.packageJson.devDependencies["markdownlint-cli2"] =
        TOOL_VERSIONS.markdownlintCli2;
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

export function vitestTesting(version = TOOL_VERSIONS.vitest): Capability {
  return expandCapability("test", "10-vitest", {
    templates: ["templates/vitest"],
    addTo(project) {
      project.packageJson.scripts.test = "vitest run --passWithNoTests";
      project.packageJson.scripts["test:watch"] =
        "vitest watch --passWithNoTests";
      project.packageJson.scripts["test:coverage"] =
        "vitest run --coverage --passWithNoTests";
      project.packageJson.devDependencies.vitest = version;
      project.packageJson.devDependencies["@vitest/coverage-v8"] = version;
    },
  });
}

export function noTesting(): Capability {
  return {
    ...expandCapability("test", "11-testing-non-forge", { addTo() {} }),
    init: noOp("The agent-skill profile does not seed a test runner."),
  };
}
