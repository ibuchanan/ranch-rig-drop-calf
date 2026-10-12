import { aidev } from "./aidev.ts";
import {
  biomeToolchain,
  bunTesting,
  cleanBuild,
  docsLinting,
  forgeAhead,
  libraryBuild,
  vitestTesting,
} from "./capabilities.ts";
import type { Capability } from "./capability.ts";
import { catalog } from "./catalog.ts";
import { changelogToolchain } from "./changelog.ts";
import { evals } from "./evals.ts";
import { forgeManifest } from "./forge-manifest.ts";
import { gitHooks } from "./git-hooks.ts";
import { gitignore } from "./gitignore.ts";
import { nodeBaseline } from "./node.ts";
import { InvalidOptionsError } from "./options.ts";
import { oss, validateOssOwner } from "./oss.ts";
import { packageMetadata } from "./package-metadata.ts";
import { prelint } from "./prelint.ts";
import { createBlueprint, type ProjectBlueprint } from "./project.ts";
import { forgeSecrets } from "./secrets.ts";
import { bundleSize } from "./size-limit.ts";
import { typeScriptToolchain } from "./typescript.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [
    catalog("library"),
    packageMetadata("library"),
    oss(),
    gitignore(),
    nodeBaseline("library"),
    changelogToolchain(),
    biomeToolchain(),
    libraryBuild(),
    typeScriptToolchain(undefined, false),
    bunTesting(),
    bundleSize("Library bundle", "dist/index.mjs"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev("library"),
  ],
  "forge-app": [
    catalog("forge-app"),
    packageMetadata("forge-app"),
    oss(),
    gitignore(),
    nodeBaseline("forge-app"),
    forgeManifest(),
    changelogToolchain(),
    forgeSecrets(),
    prelint(),
    biomeToolchain(),
    vitestTesting(),
    typeScriptToolchain(),
    forgeAhead(),
    bundleSize("Forge app bundle", "dist/**/*.js"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev("forge-app"),
    evals(),
  ],
  tool: [
    catalog("tool"),
    packageMetadata("tool"),
    oss(),
    gitignore(),
    nodeBaseline("tool"),
    changelogToolchain(),
    biomeToolchain(),
    typeScriptToolchain(),
    bunTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev("tool"),
  ],
  "agent-skill": [
    catalog("agent-skill"),
    packageMetadata("agent-skill"),
    oss(),
    gitignore(),
    nodeBaseline("agent-skill"),
    biomeToolchain(),
    typeScriptToolchain(),
    bunTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev("agent-skill"),
  ],
};

export type ProjectProfile = keyof typeof PROFILES;

export { InvalidOptionsError } from "./options.ts";

export function resolveProfile(
  profile: string | undefined,
  withFunctions: string[] = [],
  withoutFunctions: string[] = [],
  preset?: string,
): Capability[] {
  const capabilities = profile ? PROFILES[profile] : undefined;
  if (!profile || !capabilities || !Object.hasOwn(PROFILES, profile)) {
    throw new InvalidOptionsError(
      `Select a project kind with --profile: library, forge-app, tool, agent-skill (received ${JSON.stringify(profile)}).`,
    );
  }
  if (preset !== undefined && preset !== "all") {
    throw new InvalidOptionsError(
      `Unknown preset ${JSON.stringify(preset)}; use all or omit --preset.`,
    );
  }
  for (const [verb, names] of [
    ["with", withFunctions],
    ["without", withoutFunctions],
  ] as const) {
    for (const name of names) {
      const capability = capabilities.find((item) => item.name === name);
      if (!capability?.selection?.[verb])
        throw new InvalidOptionsError(
          `Cannot select optional function ${JSON.stringify(name)} with --${verb} on ${profile}; kind slots are mandatory unless their capability allows selection.`,
        );
      if (withFunctions.includes(name) && withoutFunctions.includes(name))
        throw new InvalidOptionsError(
          `Function ${name} cannot appear in both --with and --without.`,
        );
    }
  }
  return capabilities.filter(
    (capability) =>
      !withoutFunctions.includes(capability.name) &&
      (!capability.selection ||
        capability.selection.default ||
        preset === "all" ||
        withFunctions.includes(capability.name)),
  );
}

export function buildProject(
  profile: string | undefined,
  packageName: string,
  owner: string,
  description = "",
  _author = "",
  withFunctions: string[] = [],
  withoutFunctions: string[] = [],
  preset?: string,
): ProjectBlueprint {
  const capabilities = resolveProfile(
    profile,
    withFunctions,
    withoutFunctions,
    preset,
  );
  // Retain the public author input for compatibility; catalog owner wins.
  const project = createBlueprint(packageName, description, owner);
  for (const capability of capabilities) {
    if (typeof capability.init === "function") capability.init(project);
  }
  validateOssOwner(owner);
  return project;
}
