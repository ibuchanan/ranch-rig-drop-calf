import type { ProjectBlueprint } from "./project.ts";
import { TOOL_VERSIONS } from "./versions.ts";
import { biomeToolchain } from "./biome.ts";

export type Capability = {
  addTo(project: ProjectBlueprint): void;
};

export { biomeToolchain };

export function forgeAhead(): Capability {
  return {
    addTo(project) {
      project.packageJson.dependencies = {
        "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
        "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
        "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
      };
    },
  };
}

export function forgeLinting(): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies["@ast-grep/cli"] =
        TOOL_VERSIONS.astGrep;
      project.packageJson.devDependencies["tool-forge-prelint-ast-grep"] =
        TOOL_VERSIONS.forgePrelint;
      project.packageJson.scripts["lint:prelint"] =
        "ast-grep scan --config node_modules/tool-forge-prelint-ast-grep/sgconfig.ecosol.yml --globs '!node_modules/**'";
      project.packageJson.scripts["lint:forge"] = "forge lint";
      project.packageJson.scripts.lint =
        "npm run lint:prelint && npm run lint:check && npm run lint:forge";
    },
  };
}

export function libraryBuild(version = TOOL_VERSIONS.tsdown): Capability {
  return {
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
  };
}

export function cleanBuild(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.clean = "rm -rf dist";
    },
  };
}

/**
 * Lint the seeded documentation tree. The tool config is pinned in
 * `templates/docs` alongside the Markdown it checks; this only wires up the
 * runner, so a project that replaces the configs still keeps one entry point.
 */
export function docsLinting(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts["lint:docs"] =
        'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"';
      project.packageJson.devDependencies.cspell = TOOL_VERSIONS.cspell;
      project.packageJson.devDependencies["markdownlint-cli2"] =
        TOOL_VERSIONS.markdownlintCli2;
    },
  };
}

export function bunTesting(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.test = "bun test --pass-with-no-tests";
      project.packageJson.scripts["test:watch"] =
        "bun test --watch --pass-with-no-tests";
      project.packageJson.scripts["test:coverage"] =
        "bun test --coverage --pass-with-no-tests";
    },
  };
}

export function vitestTesting(version = TOOL_VERSIONS.vitest): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.test = "vitest run";
      project.packageJson.devDependencies.vitest = version;
    },
  };
}

export function noTesting(): Capability {
  return {
    addTo() {},
  };
}
