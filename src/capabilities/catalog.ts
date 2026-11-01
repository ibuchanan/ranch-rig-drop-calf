import type { Directory } from "@dagger.io/dagger";
import { validate } from "@roadiehq/roadie-backstage-entity-validator";
import { isMap, parseDocument, visit } from "yaml";
import { type Capability, noOp, type Validation } from "../core/capability.ts";
import {
  PrerequisiteError,
  ParseError,
  ValidationError,
} from "../core/errors.ts";
import { templateTree } from "../core/templates.ts";

export const CATALOG_FILE = "catalog-info.yaml";
export const CATALOG_TEMPLATE = "templates/catalog";
export const COPYRIGHT_DATE = "forge-ranch/copyright-date";
export const PACKAGE_NAME = "forge-ranch/package-name";
export const LICENSE = "forge-ranch/license";

/** Consumers require the catalog before deriving their owned outputs. */
export async function readCatalog(directory: Directory, consumer: string) {
  if (!(await directory.exists(CATALOG_FILE)))
    throw new PrerequisiteError({
      source: consumer,
      path: CATALOG_FILE,
      discovered: "is missing",
      wanted: "shared metadata before owned outputs are derived",
      remedy: "run init to seed the catalog, then update",
    });
  return catalogDocument(await directory.file(CATALOG_FILE).contents());
}

/** Consumers require a nonempty license annotation before mutating owned outputs. */
export async function readCatalogLicense(
  directory: Directory,
  consumer: string,
): Promise<string> {
  const catalog = await readCatalog(directory, consumer);
  const license = catalog.getIn(["metadata", "annotations", LICENSE]);
  if (typeof license !== "string" || !license.trim())
    throw new ValidationError({
      source: consumer,
      path: `${CATALOG_FILE}#${LICENSE}`,
      discovered: "is not a nonempty string",
      wanted: "a license annotation",
      remedy: "set the license annotation before updating",
    });
  return license;
}

export function catalogCopyrightDate(date: unknown): string {
  const match =
    typeof date === "string" ? /^(\d{4})(?:-(\d{4}))?$/.exec(date) : null;
  if (!match || (match[2] !== undefined && match[2] < (match[1] ?? "")))
    throw new ValidationError({
      source: "catalog",
      path: `${CATALOG_FILE}#${COPYRIGHT_DATE}`,
      discovered: `is ${JSON.stringify(date) ?? String(date)}`,
      wanted: "YYYY or YYYY-YYYY with an ordered range",
      remedy: "set a single year or an ordered inclusive range",
    });
  return match[0];
}

export type CatalogSeed = {
  name: string;
  owner: string;
  type: string;
  description?: string;
  copyrightDate?: string;
};

/** Parse a single catalog mapping, rejecting malformed YAML and duplicate keys. */
function catalogDocument(contents: string) {
  const document = parseDocument(contents);
  if (document.errors.length)
    throw new ParseError(
      CATALOG_FILE,
      document.errors.map((error) => error.message).join("; "),
    );
  if (!isMap(document.contents))
    throw new ParseError(CATALOG_FILE, "expected one entity mapping");
  return document;
}

/** The staff ID is shared by package author and the OSS OWNER file. */
export function catalogOwnerId(owner: unknown): string {
  const match =
    typeof owner === "string"
      ? /^user:(?:[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?\/)?([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$/i.exec(
          owner,
        )
      : null;
  if (!match?.[1])
    throw new ValidationError({
      source: "catalog",
      path: `${CATALOG_FILE}#spec.owner`,
      discovered: `is ${JSON.stringify(owner) ?? String(owner)}`,
      wanted: "a user entity reference",
      remedy: "set spec.owner to user:default/<staff-id>",
    });
  return match[1];
}

/** Keep the original name separately; a scoped package name is not an entity ID. */
function catalogName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 63)
    .replace(/[^a-z0-9]+$/, "");
  if (!normalized)
    throw new ValidationError({
      source: "catalog",
      path: "metadata.name",
      discovered: `normalizes ${JSON.stringify(name)} to an empty identifier`,
      wanted: "a letter or digit",
      remedy: "give the project a name with a letter or digit",
    });
  return normalized;
}

/** Only seed tokens change; policy, comments, and additional fields live in the file. */
export function renderCatalog(template: string, seed: CatalogSeed): string {
  const document = catalogDocument(template);
  const values: Record<string, string> = {
    "[Catalog name]": catalogName(seed.name),
    "[Project name]": seed.name,
    "[Package name]": seed.name,
    "[Description]": seed.description ?? "",
    "[Owner]": `user:default/${seed.owner}`,
    "[Project kind]": seed.type,
    "[Copyright date]": seed.copyrightDate ?? String(new Date().getFullYear()),
  };
  visit(document, {
    Scalar(_key, scalar) {
      if (
        typeof scalar.value === "string" &&
        Object.hasOwn(values, scalar.value)
      )
        scalar.value = values[scalar.value];
    },
  });
  return document.toString({ lineWidth: 0 });
}

async function copyCatalog(
  destination: Directory,
  source: Directory,
  seed: CatalogSeed,
): Promise<Directory> {
  return destination.withNewFile(
    CATALOG_FILE,
    renderCatalog(await source.file(CATALOG_FILE).contents(), seed),
  );
}

/** Structural acceptance only: no policy comparison or external reference lookup. */
async function validateCatalog(directory: Directory): Promise<Validation> {
  if (!(await directory.exists(CATALOG_FILE)))
    return { status: "skipped", reason: `${CATALOG_FILE} is missing` };
  const contents = await directory.file(CATALOG_FILE).contents();
  const document = catalogDocument(contents);
  try {
    await validate(contents, false);
  } catch (error) {
    throw new ValidationError({
      source: "catalog",
      path: CATALOG_FILE,
      discovered: error instanceof Error ? error.message : String(error),
      remedy: "fix the component entity so Backstage accepts it",
    });
  }
  if (document.get("kind") !== "Component")
    throw new ValidationError({
      source: "catalog",
      path: `${CATALOG_FILE}#kind`,
      discovered: `is ${JSON.stringify(document.get("kind"))}`,
      wanted: "Component",
      remedy: "declare a Backstage Component entity",
    });
  catalogOwnerId(document.getIn(["spec", "owner"]));
  const date = document.getIn(["metadata", "annotations", COPYRIGHT_DATE]);
  if (date !== undefined) catalogCopyrightDate(date);
  return { status: "validated" };
}

export function catalog(kind?: string): Capability {
  return {
    name: "catalog",
    documentation: {
      tools: [
        {
          name: "Backstage Entity Validator",
          url: "https://www.npmjs.com/package/@roadiehq/roadie-backstage-entity-validator",
          purpose:
            "Validates catalog-info.yaml component entities against Backstage schema",
        },
      ],
      init: "Seeds catalog-info.yaml with project metadata from package.json and CLI inputs",
      validate:
        "Check YAML and Backstage Component structure, user owner reference, and optional copyright-date format; no remote lookup.",
    },
    init(project) {
      if (!kind) throw new Error("Catalog init requires a project kind.");
      const seed = {
        name: project.packageJson.name,
        owner: project.packageJson.author ?? "",
        description: project.packageJson.description ?? "",
        type: kind,
      };
      project.templates.push(
        templateTree(CATALOG_TEMPLATE, (destination, source) =>
          copyCatalog(destination, source, seed),
        ),
      );
    },
    update: noOp("Catalog owns the file, but no update policy is defined."),
    validate: validateCatalog,
  };
}
