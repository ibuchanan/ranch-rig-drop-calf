import type { ProjectBlueprint } from "./project.ts";

export type Capability = {
  addTo(project: ProjectBlueprint): void;
};

export function biomeLinting(version = "^1.9.4"): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.lint = "biome lint";
      project.packageJson.scripts["lint:fix"] = "biome lint --write";
      project.packageJson.devDependencies["@biomejs/biome"] = version;
      project.files.set("biome.json", buildBiomeConfig());
    },
  };
}

export function forgeLinting(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.lint = "forge lint";
    },
  };
}

export function biomeFormatting(version = "^1.9.4"): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.format = "biome format --write";
      project.packageJson.scripts["format:check"] = "biome format";
      project.packageJson.devDependencies["@biomejs/biome"] = version;
      if (!project.files.has("biome.json")) {
        project.files.set("biome.json", buildBiomeConfig());
      }
    },
  };
}

export function tscTypecheck(tsVersion = "^5.4.0"): Capability {
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

export function forgeTypecheck(tsVersion = "^5.9.3"): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies.typescript = tsVersion;
      project.packageJson.scripts.typecheck = "tsc --noEmit";
    },
  };
}

export function libraryBuild(version = "^0.15.0"): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.build = "tsdown";
      project.packageJson.devDependencies.tsdown = version;
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
      project.packageJson.scripts.test = "bun test";
    },
  };
}

export function vitestTesting(version = "^2.1.0"): Capability {
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

function buildBiomeConfig(): string {
  return JSON.stringify(
    {
      $schema: "https://biomejs.dev/schemas/1.9.4/schema.json",
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
  );
}
