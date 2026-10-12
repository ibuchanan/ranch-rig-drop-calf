import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { CST, isAlias, isMap, isScalar, isSeq, parseDocument } from "yaml";
import { ParseError } from "./preclean.ts";

/** Sections where a scaffold entry survives unless the blueprint owns the key. */
const MERGED_SECTIONS = ["scripts", "devDependencies", "dependencies"] as const;

/** Reject malformed JSON and non-object roots before modifying shared metadata. */
export function parseObject(
  path: string,
  contents: string,
): Record<string, unknown> {
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
 * fields like `main` outside the blueprint's scope. Generated privacy defaults
 * override scaffold values. Without this,
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
  // Scaffold engine constraints are not the development-toolchain baseline.
  const engines = merged.engines;
  if (engines && typeof engines === "object" && !Array.isArray(engines)) {
    const { node: _node, ...other } = engines as Record<string, unknown>;
    if (Object.keys(other).length) merged.engines = other;
    else delete merged.engines;
  }
  return sortPackageJson(`${JSON.stringify(merged, null, 2)}\n`);
}

export type ScaffoldTypeScriptPlan = {
  renames: { from: string; to: string }[];
  manifest: string | undefined;
};

/** Adopt root scaffold source without changing code or weakening strict checks. */
export function planScaffoldTypeScript(
  paths: readonly string[],
  manifest?: string,
): ScaffoldTypeScriptPlan {
  const existing = new Set(paths);
  const renames = paths
    .filter((path) => /^src\/.*\.(js|jsx)$/.test(path))
    .map((from) => ({ from, to: from.replace(/\.js(x?)$/, ".ts$1") }));
  for (const { from, to } of renames)
    if (existing.has(to))
      throw new Error(
        `cannot rename ${from}: ${to} already exists; resolve the collision before init.`,
      );
  if (!renames.length || manifest === undefined) return { renames, manifest };

  const document = parseDocument(manifest, { keepSourceTokens: true });
  if (document.errors.length)
    throw new ParseError(
      "manifest.yml",
      document.errors.map((error) => error.message).join("; "),
    );
  if (!isMap(document.contents))
    throw new ParseError("manifest.yml", "expected a mapping at document root");
  const resources = document.get("resources", true);
  if (resources === undefined) return { renames, manifest };
  if (!isSeq(resources))
    throw new ParseError("manifest.yml", "expected a sequence at resources");
  const destinations = new Map(renames.map(({ from, to }) => [from, to]));
  const edits: { start: number; end: number; value: string }[] = [];
  for (const resource of resources.items) {
    if (!isMap(resource))
      throw new ParseError("manifest.yml", "expected a mapping in resources");
    const reference = resource.get("path", true);
    const path = isAlias(reference) ? reference.resolve(document) : reference;
    if (!isScalar(path) || typeof path.value !== "string" || !path.srcToken)
      throw new ParseError(
        "manifest.yml",
        "expected a string at resources[].path",
      );
    const to = destinations.get(path.value);
    if (to && isAlias(reference) && reference.range) {
      edits.push({
        start: reference.range[0],
        end: reference.range[1],
        value: JSON.stringify(to),
      });
    } else if (to) {
      const token = path.srcToken;
      const end = token.offset + CST.stringify(token).length;
      CST.setScalarValue(token, to, { afterKey: true });
      const value = CST.stringify(token).replace(
        /\r?\n/g,
        manifest.includes("\r\n") ? "\r\n" : "\n",
      );
      edits.push({ start: token.offset, end, value });
    }
  }
  // Replace only path scalars, from the end so YAML comments and offsets survive.
  for (const { start, end, value } of edits.sort((a, b) => b.start - a.start))
    manifest = manifest.slice(0, start) + value + manifest.slice(end);
  return { renames, manifest };
}

/** Dagger applies the pure plan only during top-level Forge initialization. */
export async function adoptScaffoldTypeScript(
  directory: Directory,
): Promise<Directory> {
  const manifest = (await directory.exists("manifest.yml"))
    ? await directory.file("manifest.yml").contents()
    : undefined;
  const plan = planScaffoldTypeScript(
    await directory.glob("src/**/*"),
    manifest,
  );
  let result = directory;
  for (const { from, to } of plan.renames)
    result = result.withFile(to, directory.file(from)).withoutFile(from);
  if (plan.manifest !== undefined && plan.manifest !== manifest)
    result = result.withNewFile("manifest.yml", plan.manifest);
  return result;
}

/** The scaffold's own package name, used when none is given. */
export function scaffoldName(scaffold: string | undefined): string | undefined {
  if (scaffold === undefined) return undefined;
  const name = parseObject("package.json", scaffold).name;
  return typeof name === "string" && name.trim() ? name : undefined;
}
