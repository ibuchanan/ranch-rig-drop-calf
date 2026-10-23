import type { Directory } from "@dagger.io/dagger";
import {
  AGENT_SKILL_AIDEV_TEMPLATE,
  AIDEV_TEMPLATE,
  aidev,
  LIBRARY_AIDEV_TEMPLATE,
} from "../capabilities/aidev.ts";
import { biomeToolchain } from "../capabilities/biome.ts";
import { bunBaseline, bunBuild } from "../capabilities/bun.ts";
import { bunTesting } from "../capabilities/bun-testing.ts";
import { catalog } from "../capabilities/catalog.ts";
import { changelogToolchain } from "../capabilities/changelog.ts";
import { citation } from "../capabilities/citation.ts";
import { cleanBuild } from "../capabilities/clean-build.ts";
import { docsLinting } from "../capabilities/docs.ts";
import { evals } from "../capabilities/evals.ts";
import { fallow } from "../capabilities/fallow.ts";
import { forgeAhead } from "../capabilities/forge-ahead.ts";
import { forgeManifest } from "../capabilities/forge-manifest.ts";
import { gitHooks } from "../capabilities/git-hooks.ts";
import { gitignore } from "../capabilities/gitignore.ts";
import { libraryBuild } from "../capabilities/library-build.ts";
import { lint } from "../capabilities/lint.ts";
import { nodeBaseline } from "../capabilities/node.ts";
import { oss, validateOssOwner } from "../capabilities/oss.ts";
import { packageCheck } from "../capabilities/package-check.ts";
import { packageMetadata } from "../capabilities/package-metadata.ts";
import { prelint } from "../capabilities/prelint.ts";
import { release } from "../capabilities/release.ts";
import { forgeSecrets } from "../capabilities/secrets.ts";
import { bundleSize } from "../capabilities/size-limit.ts";
import { skillStarter } from "../capabilities/skill-starter.ts";
import { skillToolkit } from "../capabilities/skill-toolkit.ts";
import { todo } from "../capabilities/todo.ts";
import { typeScriptToolchain } from "../capabilities/typescript.ts";
import { vitestTesting } from "../capabilities/vitest.ts";
import type { Capability } from "../core/capability.ts";
import { InvalidOptionsError } from "../core/errors.ts";
import { seedPackage } from "../core/package-json.ts";
import { createBlueprint, type ProjectBlueprint } from "../core/project.ts";
import { adoptScaffoldTypeScript, applyPreclean } from "./scaffold.ts";

const PROJECT_KINDS = ["library", "forge-app", "tool", "agent-skill"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

export const PROFILES: Record<ProjectKind, Capability[]> = {
  library: [
    catalog("library"),
    packageMetadata(),
    oss(),
    gitignore(),
    nodeBaseline({ major: "22" }),
    changelogToolchain(),
    release({ library: true }),
    biomeToolchain(),
    lint(),
    libraryBuild(),
    packageCheck(),
    typeScriptToolchain({ ownsBuild: false }),
    bunTesting(),
    fallow(),
    cleanBuild({ reinstall: true }),
    todo(),
    docsLinting({
      testDirectory: "tests",
      testPurpose: "Bun tests for source code and workflows",
      scriptsPurpose: "Library build helpers",
    }),
    gitHooks({ buildOnPrepare: true }),
    aidev({ guidance: LIBRARY_AIDEV_TEMPLATE }),
  ],
  "forge-app": [
    catalog("forge-app"),
    packageMetadata({ enforcePrivate: true }),
    oss(),
    gitignore(),
    nodeBaseline({ engines: "remove" }),
    forgeManifest(),
    changelogToolchain(),
    release(),
    forgeSecrets(),
    prelint(),
    biomeToolchain(),
    lint(),
    vitestTesting(),
    typeScriptToolchain(),
    forgeAhead(),
    bundleSize("Forge app bundle", "dist/**/*.js"),
    cleanBuild(),
    todo(),
    docsLinting({
      testDirectory: "test",
      testPurpose: "Forge app tests (Vitest) and optional evaluations",
      scriptsPurpose: "Forge setup and deployment helpers",
    }),
    gitHooks(),
    evals(),
    aidev({ guidance: AIDEV_TEMPLATE }),
  ],
  tool: [
    catalog("tool"),
    packageMetadata(),
    oss(),
    gitignore(),
    bunBaseline(),
    changelogToolchain(),
    release({ packageManager: "bun" }),
    biomeToolchain({ packageManager: "bun" }),
    lint({ packageManager: "bun" }),
    bunBuild(),
    typeScriptToolchain({ ownsBuild: false, packageManager: "bun" }),
    bunTesting(),
    fallow({ packageManager: "bun" }),
    cleanBuild(),
    todo(),
    docsLinting({
      testDirectory: "tests",
      testPurpose: "Bun tests for CLI source and workflows",
      packageManager: "bun",
    }),
    gitHooks({ packageManager: "bun" }),
    aidev(),
  ],
  "agent-skill": [
    catalog("agent-skill"),
    packageMetadata({ enforcePrivate: true }),
    oss(),
    gitignore(),
    bunBaseline(),
    citation(),
    changelogToolchain(),
    release({ packageManager: "bun" }),
    biomeToolchain({ packageManager: "bun" }),
    lint({ packageManager: "bun" }),
    skillToolkit(),
    skillStarter(),
    typeScriptToolchain({ ownsBuild: false, packageManager: "bun" }),
    bunTesting(),
    cleanBuild(),
    todo(),
    docsLinting({
      testDirectory: "tests",
      testPurpose: "Bun tests for skill scripts",
      extraLayout: [
        "`skills/`: Agent skills, one `<name>/SKILL.md` package per directory.",
      ],
      packageManager: "bun",
    }),
    gitHooks({ packageManager: "bun" }),
    evals(),
    aidev({ guidance: AGENT_SKILL_AIDEV_TEMPLATE }),
  ],
};

/** The one place a user-supplied kind is validated. */
function projectKind(profile: string | undefined): ProjectKind {
  const kind = PROJECT_KINDS.find((known) => known === profile);
  if (!kind)
    throw new InvalidOptionsError(
      `Select a project kind with --profile: ${PROJECT_KINDS.join(", ")} (received ${JSON.stringify(profile)}).`,
    );
  return kind;
}

/** Prepares fresh scaffolder output before capability init; never runs on update. */
export type ScaffoldStep = (directory: Directory) => Promise<Directory>;

// Order matters: Forge adoption renames scaffold source before preclean removes files.
const SCAFFOLD_STEPS: Record<ProjectKind, ScaffoldStep[]> = {
  library: [applyPreclean],
  "forge-app": [adoptScaffoldTypeScript, applyPreclean],
  tool: [applyPreclean],
  "agent-skill": [applyPreclean],
};

/** The selected kind's scaffold steps, in application order. */
export function scaffoldSteps(profile: string): readonly ScaffoldStep[] {
  return SCAFFOLD_STEPS[projectKind(profile)];
}

export function resolveProfile(
  profile: string | undefined,
  withFunctions: string[] = [],
  withoutFunctions: string[] = [],
  preset?: string,
): Capability[] {
  const capabilities = PROFILES[projectKind(profile)];
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
