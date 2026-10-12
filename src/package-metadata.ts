import type { ProjectBlueprint } from "./project.ts";
import type { Directory } from "@dagger.io/dagger";
import { NpmPackageJsonLint } from "npm-package-json-lint";
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import {
  CATALOG_FILE,
  readCatalog,
  catalogOwnerId,
  PACKAGE_NAME,
} from "./catalog.ts";
import { parseObject } from "./init.ts";

/** Catalog-derived identity and kind policy; release versions remain owner-managed. */
export async function updatePackageMetadata(
  directory: Directory,
  kind: string,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const contents = await directory.file("package.json").contents();
  const pkg = parseObject("package.json", contents);
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
    type: "module",
    ...(kind === "forge-app" || kind === "agent-skill"
      ? { private: true }
      : {}),
  };
  let changed = false;
  for (const [field, value] of Object.entries(wanted)) {
    if (pkg[field] === value) continue;
    changed = true;
    if (value === undefined) delete pkg[field];
    else pkg[field] = value;
  }
  return changed
    ? directory.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      )
    : directory;
}

/** Structural rules only: no recommended preset, baseline comparison, or autofix. */
export async function validatePackageMetadata(
  directory: Directory,
): Promise<Validation> {
  if (!(await directory.exists("package.json")))
    return { status: "skipped", reason: "package.json is missing" };
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
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
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.packageJson.version = "0.1.0";
    project.packageJson.type = "module";
    project.packageJson.private = true;
  };
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
      init: "Seed version 0.1.0, type module, and private true; top-level initialization supplies the initial package name.",
      update:
        kind === "forge-app" || kind === "agent-skill"
          ? "Derive name/description/author from catalog; enforce type module and private true, preserving release version."
          : "Derive name/description/author from catalog; enforce type module, preserving owner privacy and release version.",
      validate:
        "Check metadata field types/formats with explicit structural rules, not policy compliance.",
    },
    init: seed,
    update: (directory) => updatePackageMetadata(directory, kind),
    validate: validatePackageMetadata,
  };
}
