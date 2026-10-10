import type { Directory } from "@dagger.io/dagger";
import type { Capability } from "./capabilities.ts";
import { copyTemplate, templatePaths } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The TypeScript toolchain: the compiler, the two scripts that invoke it, and
 * the config it reads. Every kind installs the same version and the same config,
 * so a repository's compiler settings match a working Forge app's.
 *
 * `vendor/explore-forge-jira-remote-data-fields` keeps `typescript` and `tsc`
 * in one place, and its two workspaces between them script exactly `build` and
 * `typecheck` — there is no `dev` script, because a Forge app is a static
 * resource bundle plus resolvers rather than a running server.
 *
 * The configs are authored content rather than derived settings: the JSONC
 * comments record which options the bundler forces and why. They are seeded
 * like the docs and OSS trees instead of being rebuilt as blueprint files.
 */
export const TYPESCRIPT_TEMPLATE = "templates/typescript";

export const TYPESCRIPT_ASSETS = [
  "tsconfig.json",
  "tsconfig.typecheck.json",
] as const;

export function copyTypeScript(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(destination, source);
}

export async function typescriptPaths(source: Directory): Promise<string[]> {
  return templatePaths(source);
}

/** Every kind installs this same compiler and runs it through these same scripts. */
export function typeScriptToolchain(
  tsVersion = TOOL_VERSIONS.typescript,
): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies.typescript = tsVersion;
      project.packageJson.scripts.build = "tsc --project tsconfig.json";
      project.packageJson.scripts.typecheck =
        "tsc --project tsconfig.typecheck.json --noEmit";
    },
  };
}
