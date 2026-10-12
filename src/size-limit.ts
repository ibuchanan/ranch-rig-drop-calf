import type { ProjectBlueprint } from "./project.ts";
import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { type Capability, noOp } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** The budget is seeded here, then owner-managed independently of tool updates. */
export const SIZE_LIMIT_FIELD = "size-limit";

/** Build first, then measure: a stale `dist/` would budget the wrong bytes. */
export const SIZE_LIMIT_COMMAND = "npm run build && size-limit";

/** The budget every generated project starts with. */
export const SIZE_LIMIT_LIMIT = "10 kB";

export async function updateSizeLimit(
  directory: Directory,
  version: string = TOOL_VERSIONS.sizeLimit,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const contents = await directory.file("package.json").contents();
  const pkg = parseObject("package.json", contents);
  let changed = false;
  for (const [section, wanted] of [
    ["scripts", { size: SIZE_LIMIT_COMMAND }],
    ["devDependencies", { "size-limit": version, "@size-limit/file": version }],
  ] as const) {
    const existing = pkg[section];
    if (
      existing !== undefined &&
      (existing === null ||
        typeof existing !== "object" ||
        Array.isArray(existing))
    )
      throw new ParseError("package.json", `${section} must be an object`);
    const fields = (existing ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(wanted)) {
      if (fields[key] === value) continue;
      fields[key] = value;
      changed = true;
    }
    pkg[section] = fields;
  }
  return changed
    ? directory.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      )
    : directory;
}

/** Seed an owner budget; maintain only the paired tools and measurement command. */
export function bundleSize(
  name: string,
  path: string,
  version: string = TOOL_VERSIONS.sizeLimit,
): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.packageJson.scripts.size = SIZE_LIMIT_COMMAND;
    Object.assign(project.packageJson.devDependencies, {
      "size-limit": version,
      "@size-limit/file": version,
    });
    project.packageJson[SIZE_LIMIT_FIELD] = [
      { name, path, limit: SIZE_LIMIT_LIMIT },
    ];
  };
  return {
    name: "size-limit",
    init: seed,
    update: (directory) => updateSizeLimit(directory, version),
    validate: noOp(
      "Size Limit has no supported configuration-only validation interface. Measurement requires build artifacts and belongs to the size workflow; validation does not build the project or assess potentially stale output.",
    ),
  };
}
