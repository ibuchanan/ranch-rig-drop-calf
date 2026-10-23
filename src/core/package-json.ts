import type { Directory } from "@dagger.io/dagger";
import semver from "semver";
import sortPackageJson from "sort-package-json";
import { ParseError } from "./errors.ts";
import { isPlainObject } from "./guards.ts";

/**
 * The one module that reads and writes `package.json` (ADR 0002).
 *
 * Capabilities declare a contribution instead of editing the file: seed
 * entries applied once at init, policy entries applied at init and on every
 * update. Seeded dependencies are also kept fresh against their pins.
 * Sections merge entry by entry; every other field is replaced whole.
 * Two contributions claiming the same key is an error.
 */
export const PACKAGE_JSON = "package.json";

/** Sections whose entries capabilities contribute one key at a time. */
const SECTIONS = ["scripts", "dependencies", "devDependencies"] as const;
type Section = (typeof SECTIONS)[number];

function isSection(field: string): field is Section {
  return (SECTIONS as readonly string[]).includes(field);
}

export type PackageFields = { [field: string]: unknown } & {
  [section in Section]?: Record<string, string>;
};

export type PackageContribution = {
  seed?: PackageFields;
  policy?: PackageFields;
  /** Fields policy keeps absent. */
  remove?: readonly string[];
};

type Contributor = {
  readonly name: string;
  readonly packageJson?: PackageContribution;
};

type Package = Record<string, unknown>;

/** Reject malformed JSON and non-object roots before modifying shared metadata. */
export function parseJsonObject(
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
  if (!isPlainObject(parsed)) throw new ParseError(path, "expected an object");
  return parsed;
}

function section(pkg: Package, name: Section): Record<string, unknown> {
  const value = pkg[name];
  if (value === undefined) return {};
  if (!isPlainObject(value))
    throw new ParseError(PACKAGE_JSON, `${name} must be an object`);
  return value;
}

function apply(pkg: Package, fields: PackageFields): void {
  for (const [field, value] of Object.entries(fields))
    pkg[field] = isSection(field)
      ? { ...section(pkg, field), ...(value as Record<string, string>) }
      : structuredClone(value);
}

/** Two-space JSON with a trailing newline, in canonical key order. */
function render(pkg: Package): string {
  return sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`);
}

export async function readPackageJson(
  directory: Directory,
): Promise<Package | undefined> {
  if (!(await directory.exists(PACKAGE_JSON))) return undefined;
  return parseJsonObject(
    PACKAGE_JSON,
    await directory.file(PACKAGE_JSON).contents(),
  );
}

/**
 * The low-level primitive for rules no contribution can express, such as
 * fields derived from the catalog. A missing file is left missing, and an
 * edit that changes nothing returns the same directory.
 */
export async function editPackageJson(
  directory: Directory,
  edit: (pkg: Package) => void,
): Promise<Directory> {
  const pkg = await readPackageJson(directory);
  if (!pkg) return directory;
  const before = JSON.stringify(pkg);
  edit(pkg);
  return JSON.stringify(pkg) === before
    ? directory
    : directory.withNewFile(PACKAGE_JSON, render(pkg));
}

type Assembled = {
  seed: PackageFields;
  policy: PackageFields;
  remove: string[];
};

/** One key a contributor owns, and how it lands in the assembled result. */
type Claim = {
  owner: string;
  key: string;
  place: (assembled: Assembled) => void;
};

const LIFECYCLES = ["seed", "policy"] as const;

/** Everything one contributor asserts, in the order conflicts should be reported. */
function claimsBy({ name, packageJson }: Contributor): Claim[] {
  const contributions = LIFECYCLES.flatMap((lifecycle) =>
    Object.entries(packageJson?.[lifecycle] ?? {}).flatMap(
      ([field, value]): Claim[] =>
        isSection(field)
          ? Object.entries(value as Record<string, string>).map(
              ([entry, version]) => ({
                owner: name,
                key: `${field}.${entry}`,
                place: (assembled) => {
                  const target = assembled[lifecycle];
                  target[field] = { ...target[field], [entry]: version };
                },
              }),
            )
          : [
              {
                owner: name,
                key: field,
                place: (assembled) => {
                  assembled[lifecycle][field] = value;
                },
              },
            ],
    ),
  );
  const removals = (packageJson?.remove ?? []).map(
    (field): Claim => ({
      owner: name,
      key: field,
      place: (assembled) => {
        assembled.remove.push(field);
      },
    }),
  );
  return [...contributions, ...removals];
}

/** Merge every contribution, rejecting any key claimed twice. */
export function assemblePackage(
  contributors: readonly Contributor[],
): Assembled {
  const owners = new Map<string, string>();
  const assembled: Assembled = { seed: {}, policy: {}, remove: [] };
  for (const claim of contributors.flatMap(claimsBy)) {
    const owner = owners.get(claim.key);
    if (owner !== undefined)
      throw new Error(
        `package.json: ${claim.key} is contributed by both ${owner} and ${claim.owner}; exactly one capability must own it.`,
      );
    owners.set(claim.key, claim.owner);
    claim.place(assembled);
  }
  return assembled;
}

/** Init state: every seed, then every policy, so a new package shows its full intent. */
export function seedPackage(
  pkg: Package,
  contributors: readonly Contributor[],
): void {
  const { seed, policy, remove } = assemblePackage(contributors);
  apply(pkg, seed);
  apply(pkg, policy);
  for (const field of remove) delete pkg[field];
}

const DEPENDENCY_SECTIONS = ["dependencies", "devDependencies"] as const;

/** The lowest version a reference admits; undefined for Git refs, tags, and `*`. */
function floor(reference: string): string | undefined {
  const range = semver.validRange(reference);
  if (!range || range === "*") return undefined;
  return semver.minVersion(range)?.version;
}

/**
 * Freshness: raise each seeded dependency the owner still declares to its pin
 * when the declaration admits only older versions. An owner ahead of the pin,
 * a removed dependency, or a reference that cannot be compared is left alone.
 */
function freshen(pkg: Package, seed: PackageFields): void {
  for (const name of DEPENDENCY_SECTIONS) {
    const pins = seed[name];
    if (!pins || pkg[name] === undefined) continue;
    const declared = section(pkg, name);
    for (const [dependency, pin] of Object.entries(pins)) {
      const current = declared[dependency];
      if (typeof current !== "string") continue;
      const have = floor(current);
      const want = floor(pin);
      if (have && want && semver.lt(have, want)) declared[dependency] = pin;
    }
  }
}

/** Update: every policy entry and removal, then freshness; seeds stay owner-managed. */
export function updatePackage(
  directory: Directory,
  contributors: readonly Contributor[],
): Promise<Directory> {
  const { seed, policy, remove } = assemblePackage(contributors);
  return editPackageJson(directory, (pkg) => {
    apply(pkg, policy);
    for (const field of remove) delete pkg[field];
    freshen(pkg, seed);
  });
}

// Metadata forge create invents for the scaffold; the blueprint supplies the
// real values, so a leftover value here would silently win over them.
const SCAFFOLD_FIELDS = [
  "name",
  "version",
  "description",
  "license",
  "main",
] as const;

// Sections Drop Calf regenerates from capabilities. The scaffold's entries are
// its own scaffolding commands, not the project's, so they are emptied rather
// than kept; generation then fills them from the profile.
const EMPTY_SECTIONS = ["scripts", "devDependencies"] as const;

/**
 * Strip the metadata `forge create` invents: drop `SCAFFOLD_FIELDS` and empty
 * `EMPTY_SECTIONS`. An already-clean file is returned untouched, so a second
 * preclean is a true no-op.
 */
export function stripScaffold(contents: string): string {
  const pkg = parseJsonObject(PACKAGE_JSON, contents);
  let changed = false;
  for (const field of SCAFFOLD_FIELDS) {
    if (Object.hasOwn(pkg, field)) {
      delete pkg[field];
      changed = true;
    }
  }
  for (const name of EMPTY_SECTIONS) {
    if (!(isPlainObject(pkg[name]) && Object.keys(pkg[name]).length === 0)) {
      pkg[name] = {};
      changed = true;
    }
  }
  return changed ? render(pkg) : contents;
}

/**
 * Combine the precleaned `forge create` scaffold with the generated package.
 *
 * Generated keys win, because the blueprint owns them. Everything else the
 * scaffold carried survives: runtime `dependencies` such as `@forge/api`, and
 * fields like `main` outside the blueprint's scope. Without this, overlaying
 * the generated file would silently drop the app's dependencies.
 */
export function mergeScaffoldPackage(
  scaffold: string | undefined,
  generated: string,
): string {
  const wanted = parseJsonObject("generated package.json", generated);
  if (scaffold === undefined) return generated;
  const kept = parseJsonObject(PACKAGE_JSON, scaffold);
  const merged: Package = { ...kept, ...wanted };
  for (const name of SECTIONS) {
    if (kept[name] === undefined && wanted[name] === undefined) continue;
    merged[name] = { ...section(kept, name), ...section(wanted, name) };
  }
  // Scaffold engine constraints are not the development-toolchain baseline.
  const engines = merged.engines;
  if (isPlainObject(engines)) {
    const { node: _node, ...other } = engines;
    if (Object.keys(other).length) merged.engines = other;
    else delete merged.engines;
  }
  return render(merged);
}

/** The scaffold's own package name, used when none is given. */
export function scaffoldName(scaffold: string | undefined): string | undefined {
  if (scaffold === undefined) return undefined;
  const name = parseJsonObject(PACKAGE_JSON, scaffold).name;
  return typeof name === "string" && name.trim() ? name : undefined;
}
