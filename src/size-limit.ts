import type { Capability } from "./capabilities.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The bundle-size budget: the `size-limit` tool, the `size` command that runs
 * it, and the `size-limit` section of `package.json` that names the budget.
 *
 * Unlike the Biome, TypeScript and changelog toolchains there is no template
 * tree to seed: `size-limit` reads its budgets from a `size-limit` array in
 * `package.json` rather than from a config file of its own. So the capability
 * owns that section outright — there is no separate file for authored content
 * to live in.
 */
export const SIZE_LIMIT_FIELD = "size-limit";

/** Build first, then measure: a stale `dist/` would budget the wrong bytes. */
export const SIZE_LIMIT_COMMAND = "npm run build && size-limit";

/** The budget every generated project starts with. */
export const SIZE_LIMIT_LIMIT = "10 kB";

/**
 * The bundle-size check: `size-limit` and its file adapter, the `size` script,
 * and a named budget for the build output.
 */
export function bundleSize(name: string, path: string): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.size = SIZE_LIMIT_COMMAND;
      project.packageJson.devDependencies["size-limit"] =
        TOOL_VERSIONS.sizeLimit;
      project.packageJson.devDependencies["@size-limit/file"] =
        TOOL_VERSIONS.sizeLimitFile;
      project.packageJson[SIZE_LIMIT_FIELD] = [
        { name, path, limit: SIZE_LIMIT_LIMIT },
      ];
    },
  };
}
