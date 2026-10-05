import type { ProjectBlueprint } from "./project.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export type Capability = {
  addTo(project: ProjectBlueprint): void;
};

export function biomeLinting(
  version: string = TOOL_VERSIONS.biome,
): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.lint = "biome lint";
      project.packageJson.scripts["lint:fix"] = "biome lint --write";
      project.packageJson.devDependencies["@biomejs/biome"] = version;
      project.files.set("biome.json", buildBiomeConfig(version));
    },
  };
}

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

export function biomeFormatting(
  version: string = TOOL_VERSIONS.biome,
): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.format = "biome format --write";
      project.packageJson.scripts["format:check"] = "biome format";
      project.packageJson.scripts["lint:check"] = "biome lint";
      project.packageJson.scripts["lint:fix"] = "biome lint --write";
      project.packageJson.devDependencies["@biomejs/biome"] = version;
      project.files.set("biome.json", buildBiomeConfig(version));
    },
  };
}

export function tscTypecheck(tsVersion = TOOL_VERSIONS.typescript): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies.typescript = tsVersion;
      project.packageJson.scripts.typecheck = "tsc --noEmit";
    },
  };
}

export function tscBuild(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.build = "tsc";
    },
  };
}

export function forgeTypecheck(
  tsVersion = TOOL_VERSIONS.forgeTypescript,
): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies.typescript = tsVersion;
      project.packageJson.scripts.typecheck =
        "tsc -p tsconfig.typecheck.json --noEmit";
      project.files.set(
        "tsconfig.json",
        `${JSON.stringify({ compilerOptions: { target: "ES2022", module: "CommonJS", moduleResolution: "Node", jsx: "react-jsx", sourceMap: true, lib: ["ES2022"], strict: true, esModuleInterop: true, skipLibCheck: true, forceConsistentCasingInFileNames: true, rootDir: "src", outDir: "dist" }, include: ["src"] }, null, 2)}\n`,
      );
      project.files.set(
        "tsconfig.typecheck.json",
        `${JSON.stringify({ extends: "./tsconfig.json", compilerOptions: { noEmit: true, noImplicitReturns: true, noUncheckedSideEffectImports: true, noImplicitOverride: true, noPropertyAccessFromIndexSignature: true, noUnusedLocals: true, noUnusedParameters: true, noFallthroughCasesInSwitch: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true } }, null, 2)}\n`,
      );
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

export function forgeBuild(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.build = "tsc -p tsconfig.json";
    },
  };
}

export function bundleSize(name: string, path: string): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.size = "npm run build && size-limit";
      project.packageJson.devDependencies["size-limit"] =
        TOOL_VERSIONS.sizeLimit;
      project.packageJson.devDependencies["@size-limit/file"] =
        TOOL_VERSIONS.sizeLimitFile;
      project.packageJson["size-limit"] = [{ name, path, limit: "10 kB" }];
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

function buildBiomeConfig(version: string): string {
  return JSON.stringify(
    {
      $schema: `https://biomejs.dev/schemas/${version.replace(/^[^\d]*/, "")}/schema.json`,
      organizeImports: {
        enabled: true,
      },
      linter: {
        enabled: true,
        rules: {
          recommended: true,
        },
      },
      formatter: {
        enabled: true,
        indentStyle: "space",
        indentWidth: 2,
        lineEnding: "lf",
      },
      files: {
        ignore: ["node_modules", "dist"],
      },
    },
    null,
    2,
  ).concat("\n");
}
