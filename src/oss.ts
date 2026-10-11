import type { Directory } from "@dagger.io/dagger";

export const OSS_LICENSE = "Apache-2.0";

/**
 * Upstream of the OSS templates. It is a private Bitbucket repository, so it
 * cannot be a submodule: Dagger initializes every submodule when it loads the
 * module from a Git ref, and the engine has no credentials for it.
 */
export const OSS_UPSTREAM = "https://bitbucket.org/atlassian/oss-templates.git";

/**
 * Pinned copy of `OSS_ASSETS` from `OSS_UPSTREAM`. Generation reads this so
 * output stays deterministic and the module loads without credentials; refresh
 * it deliberately with `bun run refresh:oss` and read the diff.
 */
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

/**
 * The `license` field is OSS metadata, so the OSS module owns it: the blueprint
 * spreads this into `package.json` beside the other base metadata. The value is
 * fixed.
 */
export function ossLicense(): { license: typeof OSS_LICENSE } {
  return { license: OSS_LICENSE };
}

export function transformOssTemplate(
  path: string,
  contents: string,
  name: string,
  owner: string,
): string {
  if (path === ".atlassian/OWNER") return owner;
  if (path === "CONTRIBUTING.md" || path === "README.md")
    return contents.replaceAll("[Project name]", name);
  if (path === "LICENSE")
    return contents.replaceAll("[YYYY]", String(new Date().getFullYear()));
  return contents;
}

export async function copyOssAssets(
  destination: Directory,
  source: Directory,
  name: string,
  owner: string,
  paths: readonly string[] = OSS_ASSETS,
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    const file = source.file(path);
    if (path === "CODE_OF_CONDUCT.md" || path === "SECURITY.md")
      result = result.withFile(path, file);
    else
      result = result.withNewFile(
        path,
        transformOssTemplate(path, await file.contents(), name, owner),
      );
  }
  return result;
}

export function validateOssOwner(owner: string): void {
  if (!/^[a-z][a-z0-9._-]*$/i.test(owner)) {
    throw new Error("OSS owner must be a nonempty staff ID");
  }
}
