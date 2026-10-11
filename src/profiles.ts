import { seedAgentGuidance } from "./aidev.ts";
import type { Capability } from "./capability.ts";
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
import { catalog } from "./catalog.ts";
import { changelogToolchain } from "./changelog.ts";
import { evals } from "./evals.ts";
import { gitHooks } from "./git-hooks.ts";
import { nodeBaseline } from "./node.ts";
import { validateOssOwner } from "./oss.ts";
import { prelint } from "./prelint.ts";
import { createBlueprint, type ProjectBlueprint } from "./project.ts";
import { forgeSecrets } from "./secrets.ts";
import { bundleSize } from "./size-limit.ts";
import { typeScriptToolchain } from "./typescript.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [
    catalog(),
    nodeBaseline(),
    changelogToolchain(),
    biomeToolchain(),
    typeScriptToolchain(),
    bunTesting(),
    libraryBuild(),
    bundleSize("Library bundle", "dist/index.js"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
  ],
  "forge-app": [
    catalog(),
    nodeBaseline(),
    changelogToolchain(),
    forgeSecrets(),
    prelint(),
    biomeToolchain(),
    typeScriptToolchain(),
    forgeAhead(),
    vitestTesting(),
    bundleSize("Forge app bundle", "dist/**/*.js"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
  ],
  tool: [
    catalog(),
    nodeBaseline(),
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
    nodeBaseline(),
    biomeToolchain(),
    typeScriptToolchain(),
    noTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
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
  for (const capability of capabilities) {
    if (typeof capability.init === "function") capability.init(project);
  }
  validateOssOwner(owner);
  if (!withoutFunctions.includes("aidev")) seedAgentGuidance(project, profile);
  return project;
}
