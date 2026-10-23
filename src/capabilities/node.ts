import { type Directory, dag } from "@dagger.io/dagger";
import { subset, validRange } from "semver";
import type { Capability, Validation } from "../core/capability.ts";
import { ensureFile } from "../core/files.ts";
import { editPackageJson, readPackageJson } from "../core/package-json.ts";
import { nodeContainer, REPOSITORY, runTool } from "../core/tool-run.ts";
import { NODE_MAJOR, TOOL_VERSIONS } from "../core/versions.ts";
import { updatePackageLicense } from "./package-metadata.ts";

/**
 * Update owns .nvmrc and the whole .npmrc; Forge manifest updates are separate.
 * @types/node stays within an explicitly selected major; otherwise it is kept fresh.
 * No kind generates engines: a toolchain baseline
 * is not a library's compatibility promise, and engines has troubled forge deploy.
 * The engines option decides whether update removes or preserves owner declarations.
 */
export const NODE_NVMRC = `${NODE_MAJOR}\n`;
const NPM_REGISTRY = "https://registry.npmjs.org/";
export const NPMRC = `# Use the public npm registry (not the default for internal Atlassians)\nregistry=${NPM_REGISTRY}\n`;
/** Whether a declared `@types/node` range admits only the selected major. */
function withinMajor(types: unknown, major: string): boolean {
  const range = typeof types === "string" ? validRange(types) : null;
  return range !== null && subset(range, `${major}.x`);
}

/** Dependency sections of a package that are plain objects an owner may have declared. */
function declaredSections(pkg: Record<string, unknown>) {
  return (["dependencies", "devDependencies"] as const)
    .map((section) => pkg[section])
    .filter(
      (value): value is Record<string, unknown> =>
        typeof value === "object" && value !== null && !Array.isArray(value),
    );
}

/** Explicit majors constrain existing Node type ranges without restoring removed dependencies. */
async function updateNode(
  directory: Directory,
  major?: string,
): Promise<Directory> {
  let result = await updatePackageLicense(directory, "node");
  if (major !== undefined && (await readPackageJson(result)))
    result = await editPackageJson(result, (pkg) => {
      for (const dependencies of declaredSections(pkg))
        if (
          dependencies["@types/node"] !== undefined &&
          !withinMajor(dependencies["@types/node"], major)
        )
          dependencies["@types/node"] = major;
    });
  for (const [path, wanted] of [
    [".nvmrc", `${major ?? NODE_MAJOR}\n`],
    [".npmrc", NPMRC],
  ] as const)
    result = await ensureFile(result, path, wanted);
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
  /** Pin development and existing Node type ranges to this compatibility major. */
  major?: string;
  /** `remove` for platforms whose deploy rejects engines; default preserves owner input. */
  engines?: "preserve" | "remove";
};

export function nodeBaseline({
  engines = "preserve",
  major,
}: NodeBaselineOptions = {}): Capability {
  const baseline = major ?? NODE_MAJOR;
  if (!/^[1-9]\d*$/.test(baseline) || baseline.trim() !== baseline)
    throw new Error(
      `node: expected a positive numeric major, received ${baseline}`,
    );
  const typesPolicy =
    major === undefined
      ? "keep @types/node fresh"
      : `constrain declared @types/node ranges to major ${major}`;
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
      init: `Seed Node ${baseline} .nvmrc, public-registry .npmrc, and @types/node; no engines declaration.`,
      update:
        engines === "remove"
          ? `Replace .nvmrc/.npmrc, derive package license from catalog, and remove engines; ${typesPolicy}.`
          : `Replace .nvmrc/.npmrc and derive package license from catalog; preserve engines and ${typesPolicy}.`,
      validate:
        "Use fnm to select .nvmrc (may download Node); no baseline, type-version, or deployment check.",
    },
    packageJson: {
      seed: { devDependencies: { "@types/node": baseline } },
      ...(engines === "remove" ? { remove: ["engines"] } : {}),
    },
    init(project) {
      project.files.set(".nvmrc", `${baseline}\n`);
      project.files.set(".npmrc", NPMRC);
    },
    update: (directory) => updateNode(directory, major),
    validate: validateNode,
  };
}
