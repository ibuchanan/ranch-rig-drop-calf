import { type Directory, dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "./capability.ts";
import { parseJsonObject, readPackageJson } from "./package-json.ts";
import { templateTree } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const LIBRARY_BUILD_TEMPLATE = "templates/library-build";
export const LIBRARY_BUILD_CONFIG = "tsdown.config.json";
export const LIBRARY_BUILD_SCRIPT = "scripts/build.sh";
export const LIBRARY_BUILD_COMMAND = "sh scripts/build.sh";

/** Keep the managed JSON pipeline and build script; package.json is contributed. */
export async function updateLibraryBuild(
  directory: Directory,
): Promise<Directory> {
  const pkg = await readPackageJson(directory);
  if (!pkg) return directory;
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
  const config = parseJsonObject(LIBRARY_BUILD_CONFIG, contents);
  const format = ["esm", "cjs"];
  const configChanged =
    JSON.stringify(config.format) !== JSON.stringify(format);
  config.format = format;
  let result = directory;
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
  return {
    name: "library-build",
    documentation: {
      tools: [
        {
          name: "tsdown",
          url: "https://tsdown.dev/",
          purpose:
            "Bundles a TypeScript library as ESM and CommonJS with declaration output.",
        },
      ],
      init: "Seed tsdown, the build pipeline/config, and publishing fields.",
      update:
        "Enforce the build script and ESM/CommonJS formats; preserve owner entry/dependency settings.",
    },
    packageJson: {
      seed: {
        devDependencies: { tsdown: version },
        main: "dist/index.mjs",
        types: "dist/index.d.ts",
        exports: {
          ".": {
            import: { types: "./dist/index.d.ts", default: "./dist/index.mjs" },
            require: {
              types: "./dist/index.d.cts",
              default: "./dist/index.cjs",
            },
          },
        },
        files: ["dist"],
      },
      policy: {
        scripts: { build: LIBRARY_BUILD_COMMAND },
      },
    },
    init(project) {
      project.templates.push(templateTree(LIBRARY_BUILD_TEMPLATE));
    },
    update: updateLibraryBuild,
    validate: noOp(
      "tsdown has no supported configuration-only validation interface: resolveUserConfig is internal and no-write still bundles source. Build and declaration emission belong to the build workflow; validation does not execute the pipeline or inspect stale artifacts.",
    ),
  };
}
