import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { biomeToolchain } from "./biome.ts";
import { type Capability, expandCapability, noOp } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export { docsLinting } from "./docs.ts";

export type { Capability } from "./capability.ts";
export { biomeToolchain };

export function forgeAhead(): Capability {
  return expandCapability("forge-ahead", "18-forge-ahead", {
    addTo(project) {
      project.packageJson.dependencies = {
        "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
        "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
        "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
      };
    },
  });
}

export { libraryBuild } from "./library-build.ts";

export function cleanBuild(): Capability {
  return expandCapability("clean-build", "13-clean-build", {
    addTo(project) {
      project.packageJson.scripts.clean = "rm -rf dist";
    },
  });
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
    // Retain the legacy contribution until ticket 26 contracts the old shape.
    addTo(project) {
      Object.assign(project.packageJson.scripts, BUN_TEST_SCRIPTS);
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
