import type { Directory } from "@dagger.io/dagger";
import { NpmPackageJsonLint } from "npm-package-json-lint";
import { type Capability, noOp, type Validation } from "../core/capability.ts";
import { ValidationError } from "../core/errors.ts";
import { isPlainObject } from "../core/guards.ts";
import { editPackageJson, readPackageJson } from "../core/package-json.ts";
import {
  CATALOG_FILE,
  catalogOwnerId,
  PACKAGE_NAME,
  readCatalog,
} from "./catalog.ts";

/** Catalog-derived identity; kind policy is contributed, release versions owner-managed. */
async function updatePackageMetadata(directory: Directory): Promise<Directory> {
  if (!(await readPackageJson(directory))) return directory;
  const catalog = await readCatalog(directory, "package-metadata");
  const name = catalog.getIn(["metadata", "annotations", PACKAGE_NAME]);
  if (typeof name !== "string" || !name.trim())
    throw new ValidationError({
      source: "package-metadata",
      path: `${CATALOG_FILE}#${PACKAGE_NAME}`,
      discovered: "is not a nonempty string",
      wanted: "a package name annotation",
      remedy: "set the annotation before updating",
    });
  const description = catalog.getIn(["metadata", "description"]);
  if (description !== undefined && typeof description !== "string")
    throw new ValidationError({
      source: "package-metadata",
      path: `${CATALOG_FILE}#metadata.description`,
      discovered: "must be a string",
      remedy: "write the catalog description as a YAML string",
    });
  const wanted: Record<string, unknown> = {
    name,
    description,
    author: catalogOwnerId(catalog.getIn(["spec", "owner"])),
  };
  return editPackageJson(directory, (pkg) => {
    for (const [field, value] of Object.entries(wanted)) {
      if (value === undefined) delete pkg[field];
      else pkg[field] = value;
    }
  });
}

/** Structural rules only: no recommended preset, baseline comparison, or autofix. */
const PACKAGE_RULES = {
  "name-type": "error",
  "name-format": "error",
  "version-type": "error",
  "version-format": "error",
  "description-type": "error",
  "private-type": "error",
  "type-type": "error",
  "valid-values-type": ["error", ["module", "commonjs"]],
};

/** An absent author, a string, or an object with a string `name`. */
function isValidAuthor(author: unknown): boolean {
  if (author === undefined || typeof author === "string") return true;
  return isPlainObject(author) && typeof author.name === "string";
}

async function validatePackageMetadata(
  directory: Directory,
): Promise<Validation> {
  if (!(await directory.exists("package.json")))
    return { status: "skipped", reason: "package.json is missing" };
  const pkg = (await readPackageJson(directory)) ?? {};
  // The linter has no author-type rule; valid-values-author enforces an allowlist.
  if (!isValidAuthor(pkg.author))
    throw new ValidationError({
      source: "package-metadata",
      path: "package.json#author",
      discovered: "is not a string or an object with a string name",
      remedy: "set author to a name string or an object with a name string",
    });
  const report = new NpmPackageJsonLint({
    packageJsonObject: pkg,
    packageJsonFilePath: "package.json",
    config: { rules: PACKAGE_RULES },
    fix: false,
  }).lint();
  const issues = report.results.flatMap((result) => result.issues);
  if (issues.length)
    throw new ValidationError({
      source: "package-metadata",
      path: "package.json",
      discovered: issues.map((issue) => issue.toString()).join("; "),
      remedy: "fix the reported metadata fields",
    });
  return { status: "validated" };
}

export type PackageMetadataOptions = {
  /** Enforce private true on update; otherwise it is only seeded, so owners may publish. */
  enforcePrivate?: boolean;
};

/** Every package starts private; enforcePrivate keeps unpublishable packages that way. */
export function packageMetadata({
  enforcePrivate = false,
}: PackageMetadataOptions = {}): Capability {
  const privacy = { private: true };
  // createBlueprint starts at the same version; the seed records who owns it.
  const version = { version: "0.1.0" };
  return {
    name: "package-metadata",
    documentation: {
      tools: [
        {
          name: "npm-package-json-lint",
          url: "https://www.npmjs.com/package/npm-package-json-lint",
          purpose:
            "Checks package metadata field types and formats with explicit structural rules.",
        },
        {
          name: "npm",
          url: "https://docs.npmjs.com/cli/",
          purpose: "Reference for package.json schema and metadata format",
        },
      ],
      update: enforcePrivate
        ? "Derive name/description/author from catalog; enforce type module and private true, preserving release version."
        : "Derive name/description/author from catalog; enforce type module, preserving owner privacy and release version.",
      validate:
        "Check metadata field types/formats with explicit structural rules, not policy compliance.",
    },
    packageJson: {
      seed: enforcePrivate ? version : { ...version, ...privacy },
      policy: { type: "module", ...(enforcePrivate ? privacy : {}) },
    },
    init: noOp(
      "Package metadata owns no files; its package.json contribution seeds version 0.1.0, type module, and private true; initialization supplies the initial package name.",
    ),
    update: updatePackageMetadata,
    validate: validatePackageMetadata,
  };
}
