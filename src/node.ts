import { type Container, type Directory, dag } from "@dagger.io/dagger";
import { isCollection, isMap, isScalar, parseDocument, visit } from "yaml";
import { type Capability, expandCapability } from "./capability.ts";
import { ParseError } from "./preclean.ts";
import { NODE_MAJOR } from "./versions.ts";

/**
 * The Node baseline: one version, spelled consistently everywhere a tool reads
 * it. `vendor/explore-forge-jira-remote-data-fields` pins `.nvmrc`, the public
 * npm registry in `.npmrc`, and `app.runtime.name` in `manifest.yml`, so a
 * Forge app's deployed runtime matches the local toolchain. `engines.node`
 * and `@types/node` carry the same major into `package.json`.
 *
 * Runtime reconciliation rejects a different runtime unless `init` explicitly
 * replaces the value invented by `forge create`. The manifest is never seeded.
 */
export const NODE_ENGINE_RANGE = `${NODE_MAJOR}.x`;
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

export class ConflictError extends Error {
  constructor(found: unknown) {
    super(
      `node: manifest.yml app.runtime.name is ${JSON.stringify(found)}; expected ${NODE_FORGE_RUNTIME}. Change app.runtime.name to ${NODE_FORGE_RUNTIME} before continuing.`,
    );
    this.name = "ConflictError";
  }
}

/** Preserve a user manifest; only first-time init may replace a scaffold pin. */
export function reconcileForgeRuntime(
  contents: string,
  replaceScaffoldRuntime = false,
): string {
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
  if (current !== undefined && current !== null && !replaceScaffoldRuntime)
    throw new ConflictError(current);

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
  replaceScaffoldRuntime = false,
): Promise<Directory> {
  if (profile !== "forge-app" || !(await directory.exists("manifest.yml")))
    return directory;
  const contents = await directory.file("manifest.yml").contents();
  const reconciled = reconcileForgeRuntime(contents, replaceScaffoldRuntime);
  return reconciled === contents
    ? directory
    : directory.withNewFile("manifest.yml", reconciled);
}

export function nodeBaseline(): Capability {
  return expandCapability("node", "05-node", {
    addTo(project) {
      project.packageJson.engines = { node: NODE_ENGINE_RANGE };
      project.packageJson.devDependencies["@types/node"] = NODE_MAJOR;
      project.files.set(".nvmrc", NODE_NVMRC);
      project.files.set(".npmrc", NPMRC);
    },
  });
}
