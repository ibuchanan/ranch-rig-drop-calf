import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { biomeToolchain } from "./biome.ts";
import { type Capability, noOp } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export { docsLinting } from "./docs.ts";

export type { Capability } from "./capability.ts";
export { biomeToolchain };

const FORGE_AHEAD_DEPENDENCIES = {
  "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
  "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
} as const;

async function updateForgeAhead(directory: Directory): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  const existing = pkg.dependencies;
  if (
    existing !== undefined &&
    (existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing))
  )
    throw new ParseError("package.json", "dependencies must be an object");
  const dependencies = (existing ?? {}) as Record<string, unknown>;
  if (
    Object.entries(FORGE_AHEAD_DEPENDENCIES).every(
      ([key, value]) => dependencies[key] === value,
    )
  )
    return directory;
  pkg.dependencies = { ...dependencies, ...FORGE_AHEAD_DEPENDENCIES };
  return directory.withNewFile(
    "package.json",
    sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
  );
}

export function forgeAhead(): Capability {
  return {
    name: "forge-ahead",
    documentation: {
      tools: [
        {
          name: "Forge Ahead API types",
          url: "https://github.com/ibuchanan/forge-ahead-atlassian-api-types",
          purpose:
            "Provides types for Atlassian API integration in Forge apps.",
        },
        {
          name: "Forge Ahead errors",
          url: "https://github.com/ibuchanan/forge-ahead-errors",
          purpose: "Provides typed error handling at Forge boundaries.",
        },
        {
          name: "Forge Ahead logging",
          url: "https://github.com/ibuchanan/forge-ahead-logging",
          purpose: "Provides logging helpers for Forge apps.",
        },
      ],
      init: "Seed API types as an owner-managed dependency.",
      update:
        "Enforce errors and logging dependencies; preserve API types and other dependencies.",
    },
    init(project) {
      project.packageJson.dependencies = {
        ...project.packageJson.dependencies,
        "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
      };
    },
    update: updateForgeAhead,
    validate: noOp(
      "Forge Ahead dependencies have no repository-local configuration to validate; comparing dependency references would check policy, not tool acceptance. Runtime integration belongs to the app's build and test workflows.",
    ),
  };
}

export { libraryBuild } from "./library-build.ts";

const CLEAN_BUILD_COMMAND = "rm -rf dist";

async function updateCleanBuild(directory: Directory): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  const existing = pkg.scripts;
  if (
    existing !== undefined &&
    (existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing))
  )
    throw new ParseError("package.json", "scripts must be an object");
  const scripts = (existing ?? {}) as Record<string, unknown>;
  if (scripts.clean === CLEAN_BUILD_COMMAND) return directory;
  pkg.scripts = { ...scripts, clean: CLEAN_BUILD_COMMAND };
  return directory.withNewFile(
    "package.json",
    sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
  );
}

export function cleanBuild(): Capability {
  return {
    name: "clean-build",
    documentation: {
      tools: [
        {
          name: "rm",
          url: "https://www.gnu.org/software/coreutils/manual/html_node/rm-invocation.html",
          purpose: "Removes dist when the owner runs the clean workflow.",
        },
      ],
      update:
        "Enforce scripts.clean as rm -rf dist in an existing package; do not execute it.",
    },
    init: noOp(
      "Clean build has no files, dependencies, or initial settings to seed; update maintains the clean script.",
    ),
    update: updateCleanBuild,
    validate: noOp(
      "Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow.",
    ),
  };
}

const BUN_TEST_SCRIPTS = {
  test: "bun test --pass-with-no-tests",
  "test:watch": "bun test --watch --pass-with-no-tests",
  "test:coverage": "bun test --coverage --pass-with-no-tests",
} as const;

async function updateBunTesting(directory: Directory): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  const existing = pkg.scripts;
  if (
    existing !== undefined &&
    (existing === null ||
      typeof existing !== "object" ||
      Array.isArray(existing))
  )
    throw new ParseError("package.json", "scripts must be an object");
  const scripts = (existing ?? {}) as Record<string, unknown>;
  if (
    Object.entries(BUN_TEST_SCRIPTS).every(
      ([key, value]) => scripts[key] === value,
    )
  )
    return directory;
  pkg.scripts = { ...scripts, ...BUN_TEST_SCRIPTS };
  return directory.withNewFile(
    "package.json",
    sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
  );
}

export function bunTesting(): Capability {
  return {
    name: "test",
    documentation: {
      tools: [
        {
          name: "Bun test",
          url: "https://bun.com/docs/test",
          purpose:
            "Runs library, tool, and agent-skill tests with built-in watch and coverage support.",
        },
      ],
      update:
        "Enforce Bun test/watch/coverage scripts; preserve owner test sources.",
    },
    init: noOp(
      "Bun's built-in test runner needs no dependency or configuration seed; update maintains the test scripts, and test sources are owner-managed.",
    ),
    update: updateBunTesting,
    validate: noOp(
      "This capability owns no Bun test configuration to validate. Test execution belongs to the test workflow; comparing scripts to defaults would check policy, not tool acceptance.",
    ),
  };
}

export { vitestTesting } from "./vitest.ts";
