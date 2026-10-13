import { type Capability, noOp } from "./capability.ts";
import { editPackageJson } from "./package-json.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** The budget is seeded here, then owner-managed independently of tool updates. */
const SIZE_LIMIT_FIELD = "size-limit";

/** Build first, then measure: a stale `dist/` would budget the wrong bytes. */
export const SIZE_LIMIT_COMMAND = "npm run build && size-limit";

/** The budget every generated project starts with. */
const SIZE_LIMIT_LIMIT = "10 kB";

/** Seed an owner budget; maintain only the paired tools and measurement command. */
export function bundleSize(name: string, path: string): Capability {
  return {
    name: "size-limit",
    documentation: {
      tools: [
        {
          name: "Size Limit",
          url: "https://github.com/ai/size-limit",
          purpose:
            "Measures built file sizes against owner-managed budgets with @size-limit/file.",
        },
      ],
      update:
        "Enforce size:check and keep the seeded paired tools fresh, preserving owner budgets and paths. Remove the legacy size script only when it matches the former policy command; preserve owner-authored commands.",
    },
    packageJson: {
      seed: {
        devDependencies: {
          "size-limit": TOOL_VERSIONS.sizeLimit,
          "@size-limit/file": TOOL_VERSIONS.sizeLimit,
        },
        [SIZE_LIMIT_FIELD]: [{ name, path, limit: SIZE_LIMIT_LIMIT }],
      },
      policy: {
        scripts: { "size:check": SIZE_LIMIT_COMMAND },
      },
    },
    init: noOp(
      `Size Limit owns no files; its package.json contribution seeds the paired tools, the build-then-measure size:check script, and a ${SIZE_LIMIT_LIMIT} budget for ${path}.`,
    ),
    update(directory) {
      return editPackageJson(directory, (pkg) => {
        const scripts = pkg.scripts as Record<string, unknown> | undefined;
        if (scripts?.size === SIZE_LIMIT_COMMAND) delete scripts.size;
      });
    },
    validate: noOp(
      "Size Limit has no supported configuration-only validation interface. Measurement requires build artifacts and belongs to the size workflow; validation does not build the project or assess potentially stale output.",
    ),
  };
}
