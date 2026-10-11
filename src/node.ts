import { type Container, type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { isCollection, isMap, isScalar, parseDocument, visit } from "yaml";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { NODE_MAJOR, TOOL_VERSIONS } from "./versions.ts";

/**
 * Update owns .nvmrc, the whole .npmrc, and a Forge manifest's runtime name.
 * @types/node is init-only. No kind generates engines: a toolchain baseline
 * is not a library's compatibility promise, and engines has troubled forge deploy.
 * Forge update removes engines; other kinds preserve owner declarations.
 */
export const NODE_NVMRC = `${NODE_MAJOR}\n`;
export const NODE_FORGE_RUNTIME = `nodejs${NODE_MAJOR}.x`;
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

/** Enforce the owned runtime key without replacing the rest of the manifest. */
export function reconcileForgeRuntime(contents: string): string {
  const document = parseDocument(contents, { keepSourceTokens: true });
  if (document.errors.length)
    throw new ParseError(
      "manifest.yml",
      document.errors.map((error) => error.message).join("; "),
    );
  for (const path of [[], ["app"], ["app", "runtime"]]) {
    const node = document.getIn(path, true);
    if (isScalar(node) && node.value === null) {
      const map = document.createNode({});
      map.comment = node.comment;
      map.commentBefore = node.commentBefore;
      document.setIn(path, map);
    } else if (node !== undefined && !isMap(node))
      throw new ParseError(
        "manifest.yml",
        `expected a mapping at ${path.join(".") || "document root"}`,
      );
  }
  const path = ["app", "runtime", "name"];
  const current = document.getIn(path);
  if (current === NODE_FORGE_RUNTIME) return contents;
  const app = document.get("app", true);
  const indent =
    isMap(app) && app.srcToken?.type === "block-map" ? app.srcToken.indent : 2;
  document.setIn(path, NODE_FORGE_RUNTIME);
  // YAML attaches inline block-collection comments to the value. Move only
  // source-confirmed inline comments onto the key so serialization keeps them inline.
  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || !isCollection(pair.value) || pair.value.flow)
        return;
      const separator = pair.srcToken?.sep ?? [];
      const inline = separator.findIndex((token) => token.type === "comment");
      const newline = separator.findIndex((token) => token.type === "newline");
      if (inline < 0 || (newline >= 0 && inline > newline)) return;
      const comment = separator[inline]?.source.slice(1);
      if (pair.value.commentBefore === comment) {
        pair.key.comment = comment;
        pair.value.commentBefore = null;
      }
    },
  });
  let result = document.toString({ indent, lineWidth: 0 });
  if (!contents.endsWith("\n")) result = result.slice(0, -1);
  if (contents.includes("\r\n")) result = result.replaceAll("\n", "\r\n");
  return result;
}

/** The Dagger boundary never creates a manifest or edits another project kind. */
export async function applyForgeRuntime(
  directory: Directory,
  profile: string,
): Promise<Directory> {
  if (profile !== "forge-app" || !(await directory.exists("manifest.yml")))
    return directory;
  const contents = await directory.file("manifest.yml").contents();
  const reconciled = reconcileForgeRuntime(contents);
  return reconciled === contents
    ? directory
    : directory.withNewFile("manifest.yml", reconciled);
}

/** Whole-file pins are policy; package dependencies remain owner-managed after init. */
export async function updateNode(
  directory: Directory,
  kind: string,
): Promise<Directory> {
  let result = await applyForgeRuntime(directory, kind);
  if (kind === "forge-app" && (await result.exists("package.json"))) {
    const contents = await result.file("package.json").contents();
    const pkg = parseObject("package.json", contents);
    if (Object.hasOwn(pkg, "engines")) {
      delete pkg.engines;
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
  const seed: Capability["addTo"] = (project) => {
    project.packageJson.devDependencies["@types/node"] = NODE_MAJOR;
    project.files.set(".nvmrc", NODE_NVMRC);
    project.files.set(".npmrc", NPMRC);
  };
  return {
    name: "node",
    addTo: seed,
    init: seed,
    update: (directory) => updateNode(directory, kind),
    validate: validateNode,
  };
}
