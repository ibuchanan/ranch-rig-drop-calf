import sortPackageJson from "sort-package-json";
import { ParseError } from "./preclean.ts";

/** Sections where a scaffold entry survives unless the blueprint owns the key. */
const MERGED_SECTIONS = ["scripts", "devDependencies", "dependencies"] as const;

function parseObject(path: string, contents: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new ParseError(
      path,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new ParseError(path, "expected an object");
  return parsed as Record<string, unknown>;
}

/**
 * Combine the `package.json` left behind by a precleaned `forge create`
 * scaffold with the one generated for the profile.
 *
 * Generated keys win, because the blueprint owns them. Everything else the
 * scaffold carried survives: runtime `dependencies` such as `@forge/api`, and
 * fields like `main` or `private` that the blueprint never sets. Without this,
 * overlaying the generated file would silently drop the app's dependencies.
 */
export function mergeScaffoldPackage(
  scaffold: string | undefined,
  generated: string,
): string {
  const wanted = parseObject("generated package.json", generated);
  if (scaffold === undefined) return generated;
  const kept = parseObject("package.json", scaffold);
  const merged: Record<string, unknown> = { ...kept, ...wanted };
  for (const section of MERGED_SECTIONS) {
    const existing = kept[section];
    const owned = wanted[section];
    if (existing === undefined && owned === undefined) continue;
    merged[section] = {
      ...(existing as Record<string, unknown> | undefined),
      ...(owned as Record<string, unknown> | undefined),
    };
  }
  return sortPackageJson(`${JSON.stringify(merged, null, 2)}\n`);
}

/** The scaffold's own package name, used when none is given. */
export function scaffoldName(scaffold: string | undefined): string | undefined {
  if (scaffold === undefined) return undefined;
  const name = parseObject("package.json", scaffold).name;
  return typeof name === "string" && name.trim() ? name : undefined;
}
