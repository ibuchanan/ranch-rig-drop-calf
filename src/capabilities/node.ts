import { type Directory, dag } from "@dagger.io/dagger";
import type { Capability, Validation } from "../core/capability.ts";
import { editPackageJson, readPackageJson } from "../core/package-json.ts";
import { nodeContainer, REPOSITORY, runTool } from "../core/tool-run.ts";
import { NODE_MAJOR, TOOL_VERSIONS } from "../core/versions.ts";
import { CATALOG_FILE, LICENSE, readCatalog } from "./catalog.ts";

/**
 * Update owns .nvmrc and the whole .npmrc; Forge manifest updates are separate.
 * @types/node is seeded and kept fresh. No kind generates engines: a toolchain baseline
 * is not a library's compatibility promise, and engines has troubled forge deploy.
 * The engines option decides whether update removes or preserves owner declarations.
 */
export const NODE_NVMRC = `${NODE_MAJOR}\n`;
const NPM_REGISTRY = "https://registry.npmjs.org/";
export const NPMRC = `# Use the public npm registry (not the default for internal Atlassians)\nregistry=${NPM_REGISTRY}\n`;
/** Whole-file pins and catalog license are policy; dependencies remain owner-managed. */
async function updateNode(directory: Directory): Promise<Directory> {
  let result = directory;
  // The license comes from repository content, so no contribution can express it.
  if (await readPackageJson(directory)) {
    const catalog = await readCatalog(directory, "node");
    const license = catalog.getIn(["metadata", "annotations", LICENSE]);
    if (typeof license !== "string" || !license.trim())
      throw new Error(
        `node: ${CATALOG_FILE} ${LICENSE} must be a nonempty string; set the license annotation before updating.`,
      );
    result = await editPackageJson(directory, (pkg) => {
      pkg.license = license;
    });
  }
  for (const [path, wanted] of [
    [".nvmrc", NODE_NVMRC],
    [".npmrc", NPMRC],
  ] as const) {
    if (
      !(await result.exists(path)) ||
      (await result.file(path).contents()) !== wanted
    )
      result = result.withNewFile(path, wanted);
  }
  return result;
}

/** Tool acceptance only; no policy comparison, host shell change, or repository export. */
async function validateNode(directory: Directory): Promise<Validation> {
  if (!(await directory.exists(".nvmrc")))
    return { status: "skipped", reason: ".nvmrc is missing" };
  const platform = await dag.defaultPlatform();
  const arch = platform.split("/")[1];
  const asset =
    arch === "amd64" ? "fnm-linux" : arch === "arm64" ? "fnm-arm64" : undefined;
  if (!asset)
    throw new Error(`fnm validation: unsupported platform ${platform}`);
  const binary = dag.http(
    `https://github.com/Schniz/fnm/releases/download/v${TOOL_VERSIONS.fnm}/${asset}.zip`,
  );
  const container = nodeContainer()
    .withFile("/tmp/fnm.zip", binary)
    .withExec(["unzip", "-q", "/tmp/fnm.zip", "-d", "/usr/local/bin"])
    .withEnvVariable("FNM_DIR", "/fnm")
    .withEnvVariable("FNM_RESOLVE_ENGINES", "false")
    .withEnvVariable("FNM_VERSION_FILE_STRATEGY", "local")
    .withFile(`${REPOSITORY}/.nvmrc`, directory.file(".nvmrc"))
    .withWorkdir(REPOSITORY)
    .withExec([
      "bash",
      "-ec",
      'eval "$(fnm env --shell bash)"; fnm use --install-if-missing',
    ]);
  await runTool(container, "node: fnm validation");
  return { status: "validated" };
}

export type NodeBaselineOptions = {
  /** `remove` for platforms whose deploy rejects engines; default preserves owner input. */
  engines?: "preserve" | "remove";
};

export function nodeBaseline({
  engines = "preserve",
}: NodeBaselineOptions = {}): Capability {
  return {
    name: "node",
    documentation: {
      tools: [
        {
          name: "fnm (Fast Node Manager)",
          url: "https://github.com/Schniz/fnm",
          purpose:
            "Selects and, when needed, installs the Node version requested by .nvmrc.",
        },
        {
          name: "Node.js",
          url: "https://nodejs.org/",
          purpose:
            "Reference for Node.js versions and TypeScript type definitions",
        },
      ],
      init: "Seed .nvmrc, public-registry .npmrc, and @types/node; no engines declaration.",
      update:
        engines === "remove"
          ? "Replace .nvmrc/.npmrc, derive package license from catalog, and remove engines; keep @types/node fresh."
          : "Replace .nvmrc/.npmrc and derive package license from catalog; preserve engines and keep @types/node fresh.",
      validate:
        "Use fnm to select .nvmrc (may download Node); no baseline, type-version, or deployment check.",
    },
    packageJson: {
      seed: { devDependencies: { "@types/node": NODE_MAJOR } },
      ...(engines === "remove" ? { remove: ["engines"] } : {}),
    },
    init(project) {
      project.files.set(".nvmrc", NODE_NVMRC);
      project.files.set(".npmrc", NPMRC);
    },
    update: updateNode,
    validate: validateNode,
  };
}
