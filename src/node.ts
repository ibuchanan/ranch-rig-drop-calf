import type { ProjectBlueprint } from "./project.ts";
import { type Container, type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import { CATALOG_FILE, LICENSE, readCatalog } from "./catalog.ts";
import { parseObject } from "./init.ts";
import { NODE_MAJOR, TOOL_VERSIONS } from "./versions.ts";

/**
 * Update owns .nvmrc and the whole .npmrc; Forge manifest updates are separate.
 * @types/node is init-only. No kind generates engines: a toolchain baseline
 * is not a library's compatibility promise, and engines has troubled forge deploy.
 * Forge update removes engines; other kinds preserve owner declarations.
 */
export const NODE_NVMRC = `${NODE_MAJOR}\n`;
export const NPM_REGISTRY = "https://registry.npmjs.org/";
export const NPMRC = `# Use the public npm registry (not the default for internal Atlassians)\nregistry=${NPM_REGISTRY}\n`;

/**
 * The Node baseline as a native Dagger container. This is the one place the
 * Node image is chosen, so a containerized tool (such as `validateChangelog`)
 * runs the same major the file pins promise rather than whatever the host has
 * installed. The `node` image carries `git`, which containerized commands
 * dispatch through.
 */
export function nodeContainer(): Container {
  return dag.container().from(`node:${NODE_MAJOR}`);
}

/** Whole-file pins and catalog license are policy; dependencies remain owner-managed. */
export async function updateNode(
  directory: Directory,
  kind: string,
): Promise<Directory> {
  let result = directory;
  if (await result.exists("package.json")) {
    const contents = await result.file("package.json").contents();
    const pkg = parseObject("package.json", contents);
    const catalog = await readCatalog(result, "node");
    const license = catalog.getIn(["metadata", "annotations", LICENSE]);
    if (typeof license !== "string" || !license.trim())
      throw new Error(
        `node: ${CATALOG_FILE} ${LICENSE} must be a nonempty string; set the license annotation before updating.`,
      );
    const removeEngines = kind === "forge-app" && Object.hasOwn(pkg, "engines");
    if (pkg.license !== license || removeEngines) {
      pkg.license = license;
      if (removeEngines) delete pkg.engines;
      result = result.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      );
    }
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
export async function validateNode(directory: Directory): Promise<Validation> {
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
    .withFile("/repo/.nvmrc", directory.file(".nvmrc"))
    .withWorkdir("/repo")
    .withExec([
      "bash",
      "-ec",
      'eval "$(fnm env --shell bash)"; fnm use --install-if-missing',
    ]);
  try {
    await container.stdout();
  } catch (error) {
    // The generated module SDK does not re-export ExecError, but it carries stderr.
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.trim()
    )
      throw new Error(
        `node: fnm validation execution failed: ${error.stderr.trim()}`,
      );
    throw error;
  }
  return { status: "validated" };
}

export function nodeBaseline(kind: string): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.packageJson.devDependencies["@types/node"] = NODE_MAJOR;
    project.files.set(".nvmrc", NODE_NVMRC);
    project.files.set(".npmrc", NPMRC);
  };
  return {
    name: "node",
    init: seed,
    update: (directory) => updateNode(directory, kind),
    validate: validateNode,
  };
}
