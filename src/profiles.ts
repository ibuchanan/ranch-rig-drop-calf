import { seedAgentGuidance } from "./aidev.ts";
import type { Capability } from "./capabilities.ts";
import {
  biomeFormatting,
  biomeLinting,
  bundleSize,
  bunTesting,
  cleanBuild,
  forgeAhead,
  forgeBuild,
  forgeLinting,
  forgeTypecheck,
  libraryBuild,
  noTesting,
  tscBuild,
  tscTypecheck,
} from "./capabilities.ts";
import { changelog } from "./changelog.ts";
import { evals } from "./evals.ts";
import { gitHooks } from "./git-hooks.ts";
import { seedOssDocuments } from "./oss.ts";
import { createBlueprint, type ProjectBlueprint } from "./project.ts";
import { forgeSecrets } from "./secrets.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [
    changelog(),
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    bunTesting(),
    libraryBuild(),
    bundleSize("Library bundle", "dist/index.js"),
    cleanBuild(),
    gitHooks(true),
  ],
  "forge-app": [
    changelog(),
    forgeSecrets(),
    forgeLinting(),
    biomeFormatting(),
    forgeTypecheck(),
    forgeAhead(),
    bunTesting(),
    forgeBuild(),
    bundleSize("Forge app bundle", "dist/**/*.js"),
    cleanBuild(),
    gitHooks(true),
  ],
  tool: [
    changelog(),
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    bunTesting(),
    tscBuild(),
    cleanBuild(),
    gitHooks(true),
  ],
  "agent-skill": [
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    noTesting(),
    tscBuild(),
    cleanBuild(),
    gitHooks(false),
  ],
};

export type ProjectProfile = keyof typeof PROFILES;

export class InvalidOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}

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
  return capabilities;
}

export function buildProject(
  profile: string | undefined,
  packageName: string,
  owner: string,
  description = "",
  author = "",
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
  const project = createBlueprint(packageName, description, author);
  for (const capability of capabilities) capability.addTo(project);
  seedOssDocuments(project, owner);
  if (!withoutFunctions.includes("aidev")) seedAgentGuidance(project, profile);
  if (
    profile === "forge-app" &&
    (preset === "all" || withFunctions.includes("evals")) &&
    !withoutFunctions.includes("evals")
  ) {
    evals().addTo(project);
  }
  return project;
}
