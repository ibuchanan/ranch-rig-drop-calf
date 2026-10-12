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
