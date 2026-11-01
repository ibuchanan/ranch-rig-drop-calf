import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

/**
 * ADR 0004: the import direction between the source subpackages. Each
 * subpackage may import only the subpackages its row names, and nothing may
 * import the entry point.
 */
type Subpackage = "core" | "capabilities" | "composition" | "index";

const ALLOWED: Record<Subpackage, readonly Subpackage[]> = {
  core: ["core"],
  capabilities: ["core", "capabilities"],
  composition: ["core", "capabilities", "composition"],
  index: ["core", "composition"],
};

/** ADR 0004 permits one deliberate capability-to-capability edge. */
const SHARED_CAPABILITY_READER = "capabilities/catalog.ts";

const SRC = join(import.meta.dir, "../src");

/** Static, re-exported, dynamic, and side-effect relative imports. */
const RELATIVE_IMPORT =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

function specifiers(source: string): string[] {
  return [...source.matchAll(RELATIVE_IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((specifier) => specifier.startsWith("."));
}

/** An importer's path relative to `src/`, such as `core/capability.ts`. */
function subpackageOf(path: string): Subpackage {
  return path === "index.ts" ? "index" : (path.split("/")[0] as Subpackage);
}

/**
 * The subpackage a relative specifier resolves to, or `null` when it leaves
 * `src/` for a pinned asset such as `pins/package.json`.
 */
function targetOf(importer: string, specifier: string): string | null {
  const resolved = posix.normalize(
    posix.join(posix.dirname(importer), specifier),
  );
  return resolved.startsWith("..") ? null : resolved;
}

function isAllowed(importer: string, target: string): boolean {
  if (target === "index.ts") return false;
  const importerPackage = subpackageOf(importer);
  const targetPackage = subpackageOf(target);
  if (!ALLOWED[importerPackage].includes(targetPackage)) return false;
  return importerPackage === "capabilities" && targetPackage === "capabilities"
    ? target === SHARED_CAPABILITY_READER
    : true;
}

/** Relative specifiers in one source file that break the ADR 0004 direction. */
export function boundaryViolations(source: string, importer: string): string[] {
  return specifiers(source).filter((specifier) => {
    const target = targetOf(importer, specifier);
    return target !== null && !isAllowed(importer, target);
  });
}

test("src follows the ADR 0004 dependency direction", () => {
  const files = readdirSync(SRC, { recursive: true })
    .map((file) => file.toString())
    .filter((file) => file.endsWith(".ts"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  const violations = files.flatMap((file) =>
    boundaryViolations(readFileSync(join(SRC, file), "utf8"), file).map(
      (specifier) => `${file} -> ${specifier}`,
    ),
  );
  expect(violations).toEqual([]);
});

test("the boundary check enforces every ADR 0004 import row", () => {
  // core/ imports only core/.
  expect(
    boundaryViolations(
      'import { release } from "../capabilities/release.ts";',
      "core/capability.ts",
    ),
  ).toEqual(["../capabilities/release.ts"]);
  expect(
    boundaryViolations(
      'import { PROFILES } from "../composition/profiles.ts";',
      "core/capability.ts",
    ),
  ).toEqual(["../composition/profiles.ts"]);
  expect(
    boundaryViolations(
      'import { DropCalf } from "../index.ts";',
      "core/tool-run.ts",
    ),
  ).toEqual(["../index.ts"]);
  expect(
    boundaryViolations(
      'import { readCatalog } from "../core/catalog.ts";',
      "core/tool-run.ts",
    ),
  ).toEqual([]);

  // capabilities/ imports core/ and the shared catalog reader, never each other.
  expect(
    boundaryViolations(
      'import { noOp } from "../core/capability.ts";',
      "capabilities/node.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { readCatalog } from "./catalog.ts";',
      "capabilities/node.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { OSS_LICENSE } from "./oss.ts";',
      "capabilities/node.ts",
    ),
  ).toEqual(["./oss.ts"]);
  expect(
    boundaryViolations(
      'const node = await import("./node.ts");',
      "capabilities/bun.ts",
    ),
  ).toEqual(["./node.ts"]);
  expect(
    boundaryViolations(
      'export { docs } from "./docs.ts";',
      "capabilities/aidev.ts",
    ),
  ).toEqual(["./docs.ts"]);
  expect(
    boundaryViolations(
      'import { PROFILES } from "../composition/profiles.ts";',
      "capabilities/node.ts",
    ),
  ).toEqual(["../composition/profiles.ts"]);
  expect(
    boundaryViolations('import "./index.ts";', "capabilities/node.ts"),
  ).toEqual(["./index.ts"]);

  // composition/ imports core/, capabilities/, and its own modules.
  expect(
    boundaryViolations(
      'import { seedPackage } from "../core/package-json.ts";',
      "composition/profiles.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { release } from "../capabilities/release.ts";',
      "composition/profiles.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { applyPreclean } from "./scaffold.ts";',
      "composition/profiles.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { DropCalf } from "../index.ts";',
      "composition/profiles.ts",
    ),
  ).toEqual(["../index.ts"]);

  // index.ts imports core/ and composition/, and imports nothing else.
  expect(
    boundaryViolations(
      'import { renderToDirectory } from "./core/project.ts";',
      "index.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { resolveProfile } from "./composition/profiles.ts";',
      "index.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations(
      'import { release } from "./capabilities/release.ts";',
      "index.ts",
    ),
  ).toEqual(["./capabilities/release.ts"]);

  // Imports that leave src/ and external packages are not subpackage edges.
  expect(
    boundaryViolations(
      'import pins from "../../pins/package.json" with { type: "json" };',
      "core/versions.ts",
    ),
  ).toEqual([]);
  expect(
    boundaryViolations('import { dag } from "@dagger.io/dagger";', "index.ts"),
  ).toEqual([]);
});
