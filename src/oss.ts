import { type Directory, dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "./capability.ts";
import {
  CATALOG_FILE,
  COPYRIGHT_DATE,
  catalogCopyrightDate,
  catalogOwnerId,
  LICENSE,
  readCatalog,
} from "./catalog.ts";
import { templateTree } from "./templates.ts";

const OSS_LICENSE = "Apache-2.0";

/**
 * Upstream of the OSS templates. It is a private Bitbucket repository, so it
 * cannot be a submodule: Dagger initializes every submodule when it loads the
 * module from a Git ref, and the engine has no credentials for it.
 */
export const OSS_UPSTREAM = "https://bitbucket.org/atlassian/oss-templates.git";

/** Deterministic, credential-free source; refresh deliberately with bun run refresh:oss. */
export const PINNED_OSS = "vendor/oss-templates";

/** Records the upstream commit the pin was taken from. Not an OSS asset. */
export const PINNED_OSS_UPSTREAM = `${PINNED_OSS}/.upstream`;

export const OSS_ASSETS = [
  "LICENSE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  ".atlassian/OWNER",
] as const;

const OSS_UPDATE_ASSETS = OSS_ASSETS.filter((path) => path !== "README.md");

type OssMetadata = { name: string; owner: string; copyrightDate: string };

export function transformOssTemplate(
  path: string,
  contents: string,
  metadata: OssMetadata,
): string {
  if (path === ".atlassian/OWNER") return metadata.owner;
  if (path === "CONTRIBUTING.md" || path === "README.md")
    return contents.replaceAll("[Project name]", metadata.name);
  if (path === "LICENSE")
    return contents.replaceAll("[YYYY]", metadata.copyrightDate);
  return contents;
}

/** Catalog is read-only; malformed inputs fail before any asset is written. */
export async function copyOssAssets(
  destination: Directory,
  source: Directory,
  paths: readonly string[] = OSS_ASSETS,
): Promise<Directory> {
  const catalog = await readCatalog(destination, "oss");
  const name = catalog.getIn(["metadata", "title"]);
  if (typeof name !== "string" || !name.trim())
    throw new Error(
      `oss: ${CATALOG_FILE} metadata.title must be a nonempty string.`,
    );
  const license = catalog.getIn(["metadata", "annotations", LICENSE]);
  if (license !== OSS_LICENSE)
    throw new Error(
      `oss: ${CATALOG_FILE} ${LICENSE} must be ${OSS_LICENSE}; the pinned LICENSE template supports only ${OSS_LICENSE}.`,
    );
  const metadata = {
    name,
    owner: catalogOwnerId(catalog.getIn(["spec", "owner"])),
    copyrightDate: catalogCopyrightDate(
      catalog.getIn(["metadata", "annotations", COPYRIGHT_DATE]),
    ),
  };
  let result = destination;
  for (const path of paths) {
    const wanted = transformOssTemplate(
      path,
      await source.file(path).contents(),
      metadata,
    );
    if (
      !(await result.exists(path)) ||
      (await result.file(path).contents()) !== wanted
    )
      result = result.withNewFile(path, wanted);
  }
  return result;
}

export function oss(): Capability {
  return {
    name: "oss",
    documentation: {
      tools: [
        {
          name: "Apache License 2.0 / pinned Atlassian OSS templates",
          url: "https://www.apache.org/licenses/LICENSE-2.0",
          purpose:
            "Supplies licensing, contribution, conduct, security, README, and ownership documents; no executable tool.",
        },
      ],
      init: "Seed LICENSE, README.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, and .atlassian/OWNER with catalog metadata.",
      update:
        "Replace authoritative OSS documents and OWNER from pinned templates and catalog metadata; preserve README edits/deletion.",
    },
    init(project) {
      project.templates.push(templateTree(PINNED_OSS, copyOssAssets));
    },
    update: (directory) =>
      copyOssAssets(
        directory,
        dag.currentModule().source().directory(PINNED_OSS),
        OSS_UPDATE_ASSETS,
      ),
    validate: noOp(
      "These documents require manual inspection; no consuming validator checks their acceptance.",
    ),
  };
}

export function validateOssOwner(owner: string): void {
  if (!/^[a-z][a-z0-9._-]*$/i.test(owner)) {
    throw new Error("OSS owner must be a nonempty staff ID");
  }
}
