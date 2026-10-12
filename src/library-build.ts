import type { ProjectBlueprint } from "./project.ts";
import { templateTree } from "./templates.ts";
import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { type Capability, noOp } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const LIBRARY_BUILD_TEMPLATE = "templates/library-build";
export const LIBRARY_BUILD_CONFIG = "tsdown.config.json";
export const LIBRARY_BUILD_SCRIPT = "scripts/build.sh";
export const LIBRARY_BUILD_COMMAND = "sh scripts/build.sh";

export async function updateLibraryBuild(
  directory: Directory,
  version: string = TOOL_VERSIONS.tsdown,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  let changed = false;
  for (const [section, wanted] of [
    ["scripts", { build: LIBRARY_BUILD_COMMAND }],
    ["devDependencies", { tsdown: version }],
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
  // Do not silently shadow executable owner configs with a new JSON config.
  for (const extension of ["ts", "mts", "cts", "js", "mjs", "cjs"]) {
    const path = `tsdown.config.${extension}`;
    if (await directory.exists(path))
      throw new Error(
        `library-build: ${path} conflicts with the managed JSON pipeline; move its entry and dependency settings to ${LIBRARY_BUILD_CONFIG} and remove ${path}.`,
      );
  }
  if (Object.hasOwn(pkg, "tsdown"))
    throw new Error(
      `library-build: package.json#tsdown conflicts with ${LIBRARY_BUILD_CONFIG}; move its settings to ${LIBRARY_BUILD_CONFIG} and remove the tsdown field.`,
    );
  const source = dag.currentModule().source().directory(LIBRARY_BUILD_TEMPLATE);
  const exists = await directory.exists(LIBRARY_BUILD_CONFIG);
  const contents = await (exists ? directory : source)
    .file(LIBRARY_BUILD_CONFIG)
    .contents();
  const config = parseObject(LIBRARY_BUILD_CONFIG, contents);
  const format = ["esm", "cjs"];
  const configChanged =
    JSON.stringify(config.format) !== JSON.stringify(format);
  config.format = format;
  let result = changed
    ? directory.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      )
    : directory;
  if (!exists || configChanged)
    result = result.withNewFile(
      LIBRARY_BUILD_CONFIG,
      configChanged ? `${JSON.stringify(config, null, 2)}\n` : contents,
    );
  const script = await source.file(LIBRARY_BUILD_SCRIPT).contents();
  if (
    !(await directory.exists(LIBRARY_BUILD_SCRIPT)) ||
    (await directory.file(LIBRARY_BUILD_SCRIPT).contents()) !== script
  )
    result = result.withNewFile(LIBRARY_BUILD_SCRIPT, script);
  return result;
}

export function libraryBuild(
  version: string = TOOL_VERSIONS.tsdown,
): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.packageJson.scripts.build = LIBRARY_BUILD_COMMAND;
    project.packageJson.devDependencies.tsdown = version;
    project.packageJson.main = "dist/index.mjs";
    project.packageJson.types = "dist/index.d.ts";
    project.packageJson.exports = {
      ".": {
        import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
        require: { types: "./dist/index.d.cts", default: "./dist/index.cjs" },
      },
    };
    project.packageJson.files = ["dist"];
  };
  return {
    name: "library-build",
    init(project) {
      seed(project);
      project.templates.push(templateTree(LIBRARY_BUILD_TEMPLATE));
    },
    update: (directory) => updateLibraryBuild(directory, version),
    validate: noOp(
      "tsdown has no supported configuration-only validation interface: resolveUserConfig is internal and no-write still bundles source. Build and declaration emission belong to the build workflow; validation does not execute the pipeline or inspect stale artifacts.",
    ),
  };
}
