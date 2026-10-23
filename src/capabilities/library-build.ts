import { type Directory, dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { ensureFile, firstExisting } from "../core/files.ts";
import { parseJsonObject, readPackageJson } from "../core/package-json.ts";
import { templateTree } from "../core/templates.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export const LIBRARY_BUILD_TEMPLATE = "templates/library-build";
export const LIBRARY_BUILD_CONFIG = "tsdown.config.json";
export const LIBRARY_BUILD_SCRIPT = "scripts/build.sh";
export const LIBRARY_BUILD_COMMAND = "sh scripts/build.sh";

const CONFIG_EXTENSIONS = ["ts", "mts", "cts", "js", "mjs", "cjs"];

/** The managed JSON pipeline must not be shadowed by an owner's executable or inline config. */
async function rejectCompetingConfig(
  directory: Directory,
  pkg: Record<string, unknown>,
): Promise<void> {
  const path = await firstExisting(
    directory,
    CONFIG_EXTENSIONS.map((extension) => `tsdown.config.${extension}`),
  );
  if (path)
    throw new Error(
      `library-build: ${path} conflicts with the managed JSON pipeline; move its entry and dependency settings to ${LIBRARY_BUILD_CONFIG} and remove ${path}.`,
    );
  if (Object.hasOwn(pkg, "tsdown"))
    throw new Error(
      `library-build: package.json#tsdown conflicts with ${LIBRARY_BUILD_CONFIG}; move its settings to ${LIBRARY_BUILD_CONFIG} and remove the tsdown field.`,
    );
}

const FORMATS = ["esm", "cjs"];

/** The JSON pipeline with the owned `format` enforced; unrelated settings are kept. */
function enforceFormats(contents: string): string {
  const config = parseJsonObject(LIBRARY_BUILD_CONFIG, contents);
  if (JSON.stringify(config.format) === JSON.stringify(FORMATS))
    return contents;
  config.format = FORMATS;
  return `${JSON.stringify(config, null, 2)}\n`;
}

/** Keep the managed JSON pipeline and build script; package.json is contributed. */
async function updateLibraryBuild(directory: Directory): Promise<Directory> {
  const pkg = await readPackageJson(directory);
  if (!pkg) return directory;
  await rejectCompetingConfig(directory, pkg);
  const source = dag.currentModule().source().directory(LIBRARY_BUILD_TEMPLATE);
  const owner = (await directory.exists(LIBRARY_BUILD_CONFIG))
    ? directory
    : source;
  const config = enforceFormats(
    await owner.file(LIBRARY_BUILD_CONFIG).contents(),
  );
  const withConfig = await ensureFile(directory, LIBRARY_BUILD_CONFIG, config);
  let output = withConfig;
  for (const script of [LIBRARY_BUILD_SCRIPT, "scripts/declarations.mjs"])
    output = await ensureFile(
      output,
      script,
      await source.file(script).contents(),
    );
  return output;
}

export function libraryBuild(): Capability {
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
        devDependencies: { tsdown: TOOL_VERSIONS.tsdown },
        main: "dist/index.cjs",
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
