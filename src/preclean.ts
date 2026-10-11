import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";

export class ParseError extends Error {
  constructor(path: string, reason: string) {
    super(`cannot parse ${path}: ${reason}; fix the file before continuing.`);
    this.name = "ParseError";
  }
}

// Files supplied by forge create that Drop Calf replaces or regenerates.
export const UNWANTED = [
  "AGENTS.md",
  ".eslintrc",
  "README.md",
  ".gitignore",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
] as const;

// Metadata forge create invents for the scaffold; the blueprint supplies the
// real values, so a leftover value here would silently win over them.
export const SCAFFOLD_FIELDS = [
  "name",
  "version",
  "description",
  "license",
] as const;

// Sections Drop Calf regenerates from capabilities. The scaffold's entries are
// its own scaffolding commands, not the project's, so they are emptied rather
// than kept; generation then fills them from the profile.
export const EMPTY_SECTIONS = ["scripts", "devDependencies"] as const;

function isEmptyObject(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  );
}

/**
 * Strip the metadata `forge create` invents from a `package.json`: drop
 * `SCAFFOLD_FIELDS` and empty `EMPTY_SECTIONS`.
 *
 * When the file already matches, the input string is returned untouched so a
 * second preclean over an already-clean tree is a true no-op. Otherwise the
 * result is rewritten in the same two-space, trailing-newline form
 * `project` emits, then handed to `sortPackageJson` for canonical key
 * order. `sortPackageJson` preserves detected indentation and newline style, so
 * serializing first is what pins the formatting rather than sort-package-json.
 */
export function stripScaffold(contents: string): string {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(contents);
    if (pkg === null || typeof pkg !== "object" || Array.isArray(pkg))
      throw new Error("expected an object");
  } catch (error) {
    throw new ParseError(
      "package.json",
      error instanceof Error ? error.message : String(error),
    );
  }
  let changed = false;
  for (const field of SCAFFOLD_FIELDS) {
    if (Object.hasOwn(pkg, field)) {
      delete pkg[field];
      changed = true;
    }
  }
  for (const section of EMPTY_SECTIONS) {
    if (!isEmptyObject(pkg[section])) {
      pkg[section] = {};
      changed = true;
    }
  }
  if (!changed) return contents;
  return sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`);
}

export async function applyPreclean(directory: Directory): Promise<Directory> {
  let result = directory;
  for (const path of UNWANTED) {
    if (await result.exists(path)) result = result.withoutFile(path);
  }
  if (await result.exists("package.json")) {
    const contents = await result.file("package.json").contents();
    const cleaned = stripScaffold(contents);
    if (cleaned !== contents)
      result = result.withNewFile("package.json", cleaned);
  }
  return result;
}
