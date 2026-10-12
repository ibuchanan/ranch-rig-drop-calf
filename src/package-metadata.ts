import type { Directory } from "@dagger.io/dagger";
import { NpmPackageJsonLint } from "npm-package-json-lint";
import { type Capability, noOp, type Validation } from "./capability.ts";
import {
  CATALOG_FILE,
  catalogOwnerId,
  PACKAGE_NAME,
  readCatalog,
} from "./catalog.ts";
import { editPackageJson, readPackageJson } from "./package-json.ts";

/** Catalog-derived identity; kind policy is contributed, release versions owner-managed. */
async function updatePackageMetadata(directory: Directory): Promise<Directory> {
  if (!(await readPackageJson(directory))) return directory;
  const catalog = await readCatalog(directory, "package-metadata");
  const name = catalog.getIn(["metadata", "annotations", PACKAGE_NAME]);
  if (typeof name !== "string" || !name.trim())
    throw new Error(
      `package-metadata: ${CATALOG_FILE} ${PACKAGE_NAME} must be a nonempty string; set the package name annotation before updating.`,
    );
  const description = catalog.getIn(["metadata", "description"]);
  if (description !== undefined && typeof description !== "string")
    throw new Error(
      `package-metadata: ${CATALOG_FILE} metadata.description must be a string.`,
    );
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
async function validatePackageMetadata(
  directory: Directory,
): Promise<Validation> {
  if (!(await directory.exists("package.json")))
    return { status: "skipped", reason: "package.json is missing" };
  const pkg = (await readPackageJson(directory)) ?? {};
  // The linter has no author-type rule; valid-values-author enforces an allowlist.
  if (
    pkg.author !== undefined &&
    typeof pkg.author !== "string" &&
    (pkg.author === null ||
      typeof pkg.author !== "object" ||
      Array.isArray(pkg.author) ||
      typeof (pkg.author as Record<string, unknown>).name !== "string")
  )
    throw new Error(
      "package.json: author must be a string or an object with a string name.",
    );
  const rules = {
    "name-type": "error",
    "name-format": "error",
    "version-type": "error",
    "version-format": "error",
    "description-type": "error",
    "private-type": "error",
    "type-type": "error",
    "valid-values-type": ["error", ["module", "commonjs"]],
  };
  const report = new NpmPackageJsonLint({
    packageJsonObject: pkg,
    packageJsonFilePath: "package.json",
    config: { rules },
    fix: false,
  }).lint();
  const issues = report.results.flatMap((result) => result.issues);
  if (issues.length)
    throw new Error(
      `package.json: ${issues.map((issue) => issue.toString()).join("; ")}`,
    );
  return { status: "validated" };
}

/** Every kind starts private; only Forge apps and agent skills stay private by policy. */
export function packageMetadata(kind: string): Capability {
  const privacy = { private: true };
  // createBlueprint starts at the same version; the seed records who owns it.
  const version = { version: "0.1.0" };
  const alwaysPrivate = kind === "forge-app" || kind === "agent-skill";
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
      update:
        kind === "forge-app" || kind === "agent-skill"
          ? "Derive name/description/author from catalog; enforce type module and private true, preserving release version."
          : "Derive name/description/author from catalog; enforce type module, preserving owner privacy and release version.",
      validate:
        "Check metadata field types/formats with explicit structural rules, not policy compliance.",
    },
    packageJson: {
      seed: alwaysPrivate ? version : { ...version, ...privacy },
      policy: { type: "module", ...(alwaysPrivate ? privacy : {}) },
    },
    init: noOp(
      "Package metadata owns no files; its package.json contribution seeds version 0.1.0, type module, and private true; initialization supplies the initial package name.",
    ),
    update: updatePackageMetadata,
    validate: validatePackageMetadata,
  };
}
