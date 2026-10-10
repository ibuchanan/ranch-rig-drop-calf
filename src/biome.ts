import type { Directory } from "@dagger.io/dagger";
import type { Capability } from "./capabilities.ts";
import { copyTemplate, templatePaths } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The Biome toolchain: the linter/formatter, the scripts that invoke it, and
 * the config it reads. Every kind installs the same version and the same config,
 * so a repository's code style matches a working Forge app's.
 *
 * `vendor/explore-forge-jira-remote-data-fields` keeps `biome` and its scripts
 * in one place — format, format:check, lint, lint:fix — and its config is
 * authored content rather than derived settings. The JSON comments record which
 * options are chosen and why. It is seeded like the docs and OSS trees instead
 * of being rebuilt as blueprint files.
 */
export const BIOME_TEMPLATE = "templates/biome";

export const BIOME_ASSETS = ["biome.jsonc"] as const;

export function copyBiome(destination: Directory, source: Directory): Directory {
  return copyTemplate(destination, source);
}

export async function biomePaths(source: Directory): Promise<string[]> {
  return templatePaths(source);
}

/** Every kind installs this same formatter/linter and runs it through these same scripts. */
export function biomeToolchain(
  biomeVersion: string = TOOL_VERSIONS.biome,
): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies["@biomejs/biome"] = biomeVersion;
      project.packageJson.scripts.format = "biome format --write";
      project.packageJson.scripts["format:check"] = "biome format";
      project.packageJson.scripts.lint = "biome lint";
      project.packageJson.scripts["lint:fix"] = "biome lint --write";
      project.files.set("biome.jsonc", buildBiomeConfig(biomeVersion));
    },
  };
}

function buildBiomeConfig(version: string): string {
  return JSON.stringify(
    {
      $schema: `https://biomejs.dev/schemas/${version.replace(/^[^\d]*/, "")}/schema.json`,
      vcs: {
        enabled: true,
        clientKind: "git",
        useIgnoreFile: true,
        defaultBranch: "main",
      },
      files: {
        ignoreUnknown: false,
      },
      formatter: {
        enabled: true,
        indentStyle: "space",
      },
      linter: {
        enabled: true,
        rules: {
          preset: "recommended",
        },
      },
      javascript: {
        formatter: {
          quoteStyle: "double",
        },
      },
      assist: {
        enabled: true,
        actions: {
          source: {
            organizeImports: "on",
          },
        },
      },
    },
    null,
    2,
  );
}