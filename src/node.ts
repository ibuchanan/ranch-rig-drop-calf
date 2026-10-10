import { type Container, dag } from "@dagger.io/dagger";
import YAML, { isMap } from "yaml";
import type { Capability } from "./capabilities.ts";
import type { ProjectBlueprint } from "./project.ts";
import { ConflictError, ParseError, type SyncOperation } from "./sync.ts";
import { NODE_MAJOR } from "./versions.ts";

/**
 * The Node baseline: one version, spelled consistently everywhere a tool reads
 * it. `vendor/forge-bootstrap` pins it across `package.json` and `.nvmrc`, and
 * `vendor/explore-forge-jira-remote-data-fields` shows the full shape — the
 * public npm registry in `.npmrc` and `app.runtime.name` in `manifest.yml`, so
 * a Forge app's deployed runtime matches the local toolchain.
 *
 * Every one of those keys is owned. A repository that pinned a different major
 * stops with a conflict rather than being silently rewritten.
 */
export const NODE_ENGINE_RANGE = `${NODE_MAJOR}.x`;
export const NODE_NVMRC = `${NODE_MAJOR}\n`;
export const NODE_FORGE_RUNTIME = `nodejs${NODE_MAJOR}.x`;
export const NPM_REGISTRY = "https://registry.npmjs.org/";
export const NPMRC = `# Use the public npm registry (not the default for internal Atlassians)\nregistry=${NPM_REGISTRY}\n`;

const NPMRC_KEY = "registry";

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

export function nodeBaseline(): Capability {
  return {
    addTo(project) {
      project.packageJson.engines = { node: NODE_ENGINE_RANGE };
      project.packageJson.devDependencies["@types/node"] = NODE_MAJOR;
      project.files.set(".nvmrc", NODE_NVMRC);
      project.files.set(".npmrc", NPMRC);
    },
  };
}

/**
 * Plan every node-owned key against an existing repository. `manifestRuntime` is
 * only true for `forge-app`: a manifest is the user's to author, so this
 * reconciles `app.runtime.name` when one exists and never creates the file.
 */
export function planNode(
  project: ProjectBlueprint,
  current: Record<string, unknown>,
  files: ReadonlyMap<string, string>,
  manifestRuntime: boolean,
): SyncOperation[] {
  const operations: SyncOperation[] = [];
  const nvmrc = files.get(".nvmrc");
  if (nvmrc !== undefined && nvmrc.trim() !== NODE_NVMRC.trim())
    throw new ConflictError(
      "node",
      "major",
      nvmrc,
      NODE_NVMRC.trim(),
      ".nvmrc",
    );
  if (nvmrc === undefined)
    operations.push({
      path: ".nvmrc",
      key: "node",
      mode: "create-if-absent",
      before: undefined,
      after: NODE_NVMRC,
    });
  const engines = (current.engines ?? {}) as Record<string, unknown>;
  const wanted = project.packageJson.engines?.node;
  if (wanted !== undefined) {
    if (engines.node !== undefined && engines.node !== wanted)
      throw new ConflictError("engines", "node", engines.node, wanted);
    if (engines.node === undefined)
      operations.push({
        path: "package.json",
        key: "engines.node",
        mode: "structured-merge",
        before: undefined,
        after: wanted,
      });
  }
  operations.push(...planNpmrc(files.get(".npmrc")));
  if (manifestRuntime)
    operations.push(...planForgeRuntime(files.get("manifest.yml")));
  return operations;
}

function planNpmrc(existing: string | undefined): SyncOperation[] {
  if (existing === undefined)
    return [
      {
        path: ".npmrc",
        key: NPMRC_KEY,
        mode: "create-if-absent",
        before: undefined,
        after: NPMRC,
      },
    ];
  const found = readNpmrcKey(existing, NPMRC_KEY);
  if (found === undefined)
    return [
      {
        path: ".npmrc",
        key: NPMRC_KEY,
        mode: "structured-merge",
        before: existing,
        after: `${existing.replace(/\n*$/, "")}\nregistry=${NPM_REGISTRY}\n`,
      },
    ];
  if (found !== NPM_REGISTRY)
    throw new ConflictError("npmrc", NPMRC_KEY, found, NPM_REGISTRY, ".npmrc");
  return [];
}

/**
 * Read an `.npmrc` key, honouring its ini-ish syntax: comments and blank lines
 * are skipped, a `[section]` header ends the search, and a scoped key such as
 * `@acme:registry` is a different key from a bare `registry`.
 */
function readNpmrcKey(contents: string, key: string): string | undefined {
  for (const line of contents.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith("#") || value.startsWith(";")) continue;
    if (value.startsWith("[")) break;
    if (value.startsWith("!")) continue;
    const separator = value.indexOf("=");
    if (separator === -1) continue;
    if (value.slice(0, separator).trim() === key)
      return value.slice(separator + 1).trim();
  }
  return undefined;
}

function planForgeRuntime(existing: string | undefined): SyncOperation[] {
  if (existing === undefined) return [];
  const doc = YAML.parseDocument(existing, { uniqueKeys: true });
  if (doc.errors.length || !isMap(doc.contents))
    throw new ParseError(
      "manifest.yml",
      doc.errors[0]?.message ?? "expected a YAML mapping",
    );
  const found = doc.getIn(["app", "runtime", "name"]);
  if (found !== undefined && found !== NODE_FORGE_RUNTIME)
    throw new ConflictError(
      "app.runtime",
      "name",
      found,
      NODE_FORGE_RUNTIME,
      "manifest.yml",
    );
  if (found !== undefined) return [];
  doc.setIn(["app", "runtime", "name"], NODE_FORGE_RUNTIME);
  return [
    {
      path: "manifest.yml",
      key: "app.runtime.name",
      mode: "structured-merge",
      before: existing,
      after: String(doc),
    },
  ];
}
