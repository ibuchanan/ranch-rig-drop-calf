import type { Capability } from "./capabilities.ts";
import { createBlueprint, type ProjectBlueprint } from "./project.ts";
import {
  biomeFormatting,
  biomeLinting,
  bunTesting,
  cleanBuild,
  forgeBuild,
  forgeLinting,
  forgeTypecheck,
  libraryBuild,
  noTesting,
  tscBuild,
  tscTypecheck,
} from "./capabilities.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    bunTesting(),
    libraryBuild(),
    cleanBuild(),
  ],
  "forge-app": [
    forgeLinting(),
    biomeFormatting(),
    forgeTypecheck(),
    bunTesting(),
    forgeBuild(),
    cleanBuild(),
  ],
  tool: [
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    bunTesting(),
    tscBuild(),
    cleanBuild(),
  ],
  "agent-skill": [
    biomeLinting(),
    biomeFormatting(),
    tscTypecheck(),
    noTesting(),
    tscBuild(),
    cleanBuild(),
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
    if (name !== "evals") {
      throw new InvalidOptionsError(
        `Cannot select optional function ${JSON.stringify(name)}; only evals is optional and kind slots are mandatory.`,
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
  description = "",
  license = "MIT",
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
  const project = createBlueprint(packageName, description, license, author);
  for (const capability of capabilities) capability.addTo(project);
  if (
    profile === "forge-app" &&
    (preset === "all" || withFunctions.includes("evals")) &&
    !withoutFunctions.includes("evals")
  ) {
    project.packageJson.scripts.eval = "promptfoo eval";
    project.packageJson.scripts.view = "promptfoo view";
    project.packageJson.devDependencies.promptfoo = "^0.116.0";
  }
  return project;
}
