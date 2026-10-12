import { seedAgentGuidance } from "./aidev.ts";
import {
  biomeToolchain,
  bunTesting,
  cleanBuild,
  docsLinting,
  forgeAhead,
  libraryBuild,
  noTesting,
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
    catalog(),
    packageMetadata("library"),
    oss(),
    gitignore(),
    nodeBaseline("library"),
    changelogToolchain(),
    biomeToolchain(),
    typeScriptToolchain(undefined, false),
    bunTesting(),
    libraryBuild(),
    bundleSize("Library bundle", "dist/index.js"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
  ],
  "forge-app": [
    catalog(),
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
  ],
  tool: [
    catalog(),
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
  ],
  "agent-skill": [
    catalog(),
    packageMetadata("agent-skill"),
    oss(),
    gitignore(),
    nodeBaseline("agent-skill"),
    biomeToolchain(),
    typeScriptToolchain(),
    noTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
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
  for (const name of [...withFunctions, ...withoutFunctions]) {
    if (
      name === "aidev" &&
      !withFunctions.includes(name) &&
      profile === "forge-app"
    )
      continue;
    if (name !== "evals") {
      throw new InvalidOptionsError(
        `Cannot select optional function ${JSON.stringify(name)}; only evals and --without-functions aidev on forge-app are supported; kind slots are mandatory.`,
      );
    }
    if (profile !== "forge-app") {
      throw new InvalidOptionsError(
        `Function evals is only available for forge-app, not ${profile}.`,
      );
    }
  }
  if (withFunctions.includes("evals") && withoutFunctions.includes("evals")) {
    throw new InvalidOptionsError(
      "Function evals cannot appear in both --with and --without.",
    );
  }
  return [
    ...capabilities,
    ...(profile === "forge-app" &&
    (preset === "all" || withFunctions.includes("evals")) &&
    !withoutFunctions.includes("evals")
      ? [evals()]
      : []),
  ];
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
  // The legacy author input remains accepted during expansion; catalog owner wins.
  const project = createBlueprint(packageName, description, owner);
  for (const capability of capabilities) {
    if (typeof capability.init === "function") capability.init(project);
  }
  validateOssOwner(owner);
  if (!withoutFunctions.includes("aidev")) seedAgentGuidance(project, profile);
  return project;
}
