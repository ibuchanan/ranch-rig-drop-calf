import type { Directory } from "@dagger.io/dagger";
import { aidev } from "./aidev.ts";
import { biomeToolchain } from "./biome.ts";
import { bunTesting } from "./bun-testing.ts";
import type { Capability } from "./capability.ts";
import { catalog } from "./catalog.ts";
import { changelogToolchain } from "./changelog.ts";
import { cleanBuild } from "./clean-build.ts";
import { docsLinting } from "./docs.ts";
import { InvalidOptionsError } from "./errors.ts";
import { evals } from "./evals.ts";
import { forgeAhead } from "./forge-ahead.ts";
import { forgeManifest } from "./forge-manifest.ts";
import { gitHooks } from "./git-hooks.ts";
import { gitignore } from "./gitignore.ts";
import { libraryBuild } from "./library-build.ts";
import { nodeBaseline } from "./node.ts";
import { oss, validateOssOwner } from "./oss.ts";
import { seedPackage } from "./package-json.ts";
import { packageMetadata } from "./package-metadata.ts";
import { prelint } from "./prelint.ts";
import { createBlueprint, type ProjectBlueprint } from "./project.ts";
import { adoptScaffoldTypeScript, applyPreclean } from "./scaffold.ts";
import { forgeSecrets } from "./secrets.ts";
import { bundleSize } from "./size-limit.ts";
import { typeScriptToolchain } from "./typescript.ts";
import { vitestTesting } from "./vitest.ts";

export const PROFILES: Record<string, Capability[]> = {
  library: [
    catalog("library"),
    packageMetadata(),
    oss(),
    gitignore(),
    nodeBaseline(),
    changelogToolchain(),
    biomeToolchain(),
    libraryBuild(),
    typeScriptToolchain({ ownsBuild: false }),
    bunTesting(),
    bundleSize("Library bundle", "dist/index.mjs"),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev(),
  ],
  "forge-app": [
    catalog("forge-app"),
    packageMetadata({ enforcePrivate: true }),
    oss(),
    gitignore(),
    nodeBaseline({ engines: "remove" }),
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
    evals(),
    aidev({ forgeGuidance: true }),
  ],
  tool: [
    catalog("tool"),
    packageMetadata(),
    oss(),
    gitignore(),
    nodeBaseline(),
    changelogToolchain(),
    biomeToolchain(),
    typeScriptToolchain(),
    bunTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev(),
  ],
  "agent-skill": [
    catalog("agent-skill"),
    packageMetadata({ enforcePrivate: true }),
    oss(),
    gitignore(),
    nodeBaseline(),
    biomeToolchain(),
    typeScriptToolchain(),
    bunTesting(),
    cleanBuild(),
    docsLinting(),
    gitHooks(),
    aidev(),
  ],
};

export type ProjectProfile = keyof typeof PROFILES;

/** Prepares fresh scaffolder output before capability init; never runs on update. */
export type ScaffoldStep = (directory: Directory) => Promise<Directory>;

// Order matters: Forge adoption renames scaffold source before preclean removes files.
const SCAFFOLD_STEPS: Record<ProjectProfile, ScaffoldStep[]> = {
  library: [applyPreclean],
  "forge-app": [adoptScaffoldTypeScript, applyPreclean],
  tool: [applyPreclean],
  "agent-skill": [applyPreclean],
};

/** The selected kind's scaffold steps, in application order. */
export function scaffoldSteps(
  profile: ProjectProfile,
): readonly ScaffoldStep[] {
  const steps = SCAFFOLD_STEPS[profile];
  if (!steps || !Object.hasOwn(SCAFFOLD_STEPS, profile))
    throw new InvalidOptionsError(
      `No scaffold steps are declared for project kind ${JSON.stringify(profile)}.`,
    );
  return steps;
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

/** Resolve the selection, then build its blueprint. */
export function buildProject(
  profile: string | undefined,
  packageName: string,
  owner: string,
  description = "",
  withFunctions: string[] = [],
  withoutFunctions: string[] = [],
  preset?: string,
): ProjectBlueprint {
  return blueprintFor(
    resolveProfile(profile, withFunctions, withoutFunctions, preset),
    packageName,
    owner,
    description,
  );
}

/** Build the blueprint for an already-resolved capability selection. */
export function blueprintFor(
  capabilities: readonly Capability[],
  packageName: string,
  owner: string,
  description = "",
): ProjectBlueprint {
  // Catalog owner is the package author.
  const project = createBlueprint(packageName, description, owner);
  seedPackage(project.packageJson, capabilities);
  for (const capability of capabilities) {
    if (typeof capability.init === "function") capability.init(project);
  }
  validateOssOwner(owner);
  return project;
}
