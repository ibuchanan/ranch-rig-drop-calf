import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** ADR 0004: capabilities import core and the shared catalog reader, never each other. */
const CORE = "../core/";
const SHARED_CAPABILITY_READER = "./catalog.ts";

const CAPABILITY_DIR = join(import.meta.dir, "../src/capabilities");

/** Static, re-exported, dynamic, and side-effect relative imports. */
const RELATIVE_IMPORT =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']|\bimport\s+["']([^"']+)["']/g;

function isAllowed(specifier: string): boolean {
  return specifier.startsWith(CORE) || specifier === SHARED_CAPABILITY_READER;
}

/** Relative specifiers that break the capability import boundary. */
export function boundaryViolations(source: string): string[] {
  return [...source.matchAll(RELATIVE_IMPORT)]
    .map((match) => match[1] ?? match[2] ?? match[3] ?? "")
    .filter((specifier) => specifier.startsWith(".") && !isAllowed(specifier));
}

test("capabilities import only core and the shared catalog reader", () => {
  const files = readdirSync(CAPABILITY_DIR)
    .filter((file) => file.endsWith(".ts"))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  const violations = files.flatMap((file) =>
    boundaryViolations(readFileSync(join(CAPABILITY_DIR, file), "utf8")).map(
      (specifier) => `${file} -> ${specifier}`,
    ),
  );
  expect(violations).toEqual([]);
});

test("the boundary check detects capability imports and admits allowed ones", () => {
  expect(boundaryViolations('import { OSS_LICENSE } from "./oss.ts";')).toEqual(
    ["./oss.ts"],
  );
  expect(boundaryViolations('export { docs } from "./docs.ts";')).toEqual([
    "./docs.ts",
  ]);
  expect(boundaryViolations('const node = await import("./node.ts");')).toEqual(
    ["./node.ts"],
  );
  expect(
    boundaryViolations(
      'import { PROFILES } from "../composition/profiles.ts";',
    ),
  ).toEqual(["../composition/profiles.ts"]);
  expect(
    boundaryViolations('import { noOp } from "../core/capability.ts";'),
  ).toEqual([]);
  expect(
    boundaryViolations('import { readCatalog } from "./catalog.ts";'),
  ).toEqual([]);
  expect(
    boundaryViolations('import { dag } from "@dagger.io/dagger";'),
  ).toEqual([]);
});
