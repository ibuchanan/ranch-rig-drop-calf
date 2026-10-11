import { type Container, dag } from "@dagger.io/dagger";
import type { Capability } from "./capabilities.ts";
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
