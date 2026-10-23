import type { Directory } from "@dagger.io/dagger";
import {
  type Alias,
  CST,
  type Document,
  isAlias,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  type Scalar,
} from "yaml";
import { ParseError } from "../core/errors.ts";
import { PACKAGE_JSON, stripScaffold } from "../core/package-json.ts";

/**
 * Scaffold steps: prepare fresh scaffolder output (such as `forge create`)
 * before capability init; they never run on update. Profiles choose which
 * steps a kind runs. package.json cleanup and merging stay in the package-json
 * module, which owns that file (ADR 0002); this module only calls it.
 */

export type ScaffoldTypeScriptPlan = {
  renames: { from: string; to: string }[];
  manifest: string | undefined;
};

type Rename = ScaffoldTypeScriptPlan["renames"][number];
type TextEdit = { start: number; end: number; value: string };

const MANIFEST = "manifest.yml";

/** Fail with a manifest parse error unless `holds`; reads as an assertion at each call site. */
function expectManifest(holds: unknown, message: string): asserts holds {
  if (!holds) throw new ParseError(MANIFEST, message);
}

/** Root `.js`/`.jsx` source becomes `.ts`/`.tsx`, unless that would overwrite an existing file. */
function planRenames(paths: readonly string[]): Rename[] {
  const existing = new Set(paths);
  const renames = paths
    .filter((path) => /^src\/.*\.(js|jsx)$/.test(path))
    .map((from) => ({ from, to: from.replace(/\.js(x?)$/, ".ts$1") }));
  const collision = renames.find(({ to }) => existing.has(to));
  if (collision)
    throw new Error(
      `cannot rename ${collision.from}: ${collision.to} already exists; resolve the collision before init.`,
    );
  return renames;
}

/** Ways to retarget a `path:` value, by how the manifest wrote it. */
const REFERENCE_EDITS = {
  /** `*alias`: replace the alias itself with a plain string, leaving its anchor alone. */
  alias: (reference: Alias, _path: Scalar, to: string): TextEdit => {
    const [start = 0, end = start] = reference.range ?? [];
    return { start, end, value: JSON.stringify(to) };
  },
  /** A scalar: rewrite its own token so quoting style and comments survive. */
  scalar: (_reference: unknown, path: Scalar, to: string, eol = "\n") => {
    const token = path.srcToken as CST.FlowScalar | CST.BlockScalar;
    const end = token.offset + CST.stringify(token).length;
    CST.setScalarValue(token, to, { afterKey: true });
    const value = CST.stringify(token).replace(/\r?\n/g, eol);
    return { start: token.offset, end, value };
  },
};

/** The text edit that retargets one resource's `path`, or none when it is not renamed. */
function retargetResource(
  resource: unknown,
  document: Document,
  destinations: ReadonlyMap<string, string>,
  eol: string,
): TextEdit | undefined {
  expectManifest(isMap(resource), "expected a mapping in resources");
  const reference = resource.get("path", true);
  const path = isAlias(reference) ? reference.resolve(document) : reference;
  expectManifest(
    isScalar(path) && typeof path.value === "string" && path.srcToken,
    "expected a string at resources[].path",
  );
  const to = destinations.get(path.value);
  if (!to) return undefined;
  return isAlias(reference) && reference.range
    ? REFERENCE_EDITS.alias(reference, path, to)
    : REFERENCE_EDITS.scalar(reference, path, to, eol);
}

/** Replace only path scalars, applied from the end so YAML comments and offsets survive. */
function retargetManifest(
  manifest: string,
  renames: readonly Rename[],
): string {
  const document = parseDocument(manifest, { keepSourceTokens: true });
  expectManifest(
    !document.errors.length,
    document.errors.map((error) => error.message).join("; "),
  );
  expectManifest(
    isMap(document.contents),
    "expected a mapping at document root",
  );
  const resources = document.get("resources", true);
  if (resources === undefined) return manifest;
  expectManifest(isSeq(resources), "expected a sequence at resources");
  const destinations = new Map(renames.map(({ from, to }) => [from, to]));
  const eol = manifest.includes("\r\n") ? "\r\n" : "\n";
  return resources.items
    .flatMap(
      (resource) =>
        retargetResource(resource, document, destinations, eol) ?? [],
    )
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, { start, end, value }) =>
        text.slice(0, start) + value + text.slice(end),
      manifest,
    );
}

/** Adopt root scaffold source without changing code or weakening strict checks. */
export function planScaffoldTypeScript(
  paths: readonly string[],
  manifest?: string,
): ScaffoldTypeScriptPlan {
  const renames = planRenames(paths);
  if (!renames.length || manifest === undefined) return { renames, manifest };
  return { renames, manifest: retargetManifest(manifest, renames) };
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

// Files supplied by forge create that Drop Calf replaces or regenerates.
export const UNWANTED = [
  "AGENTS.md",
  ".eslintrc",
  "README.md",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
] as const;

export async function applyPreclean(directory: Directory): Promise<Directory> {
  let result = directory;
  for (const path of UNWANTED) {
    if (await result.exists(path)) result = result.withoutFile(path);
  }
  if (await result.exists(PACKAGE_JSON)) {
    const contents = await result.file(PACKAGE_JSON).contents();
    const cleaned = stripScaffold(contents);
    if (cleaned !== contents)
      result = result.withNewFile(PACKAGE_JSON, cleaned);
  }
  return result;
}
