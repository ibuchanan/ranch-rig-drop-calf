import type { Directory } from "@dagger.io/dagger";
import { ConflictError, type SyncOperation } from "./sync.ts";

export const OSS_LICENSE = "Apache-2.0";

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
 * fixed, so a repository under a different license is a conflict on sync, never
 * a silent rewrite.
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

/**
 * Plan the OSS-owned `license` key against an existing repository: fill it in
 * when absent, leave a matching value alone, and stop on a different license
 * rather than overwrite the project's choice.
 */
export function planOssLicense(
  current: Record<string, unknown>,
): SyncOperation[] {
  if (current.license !== undefined && current.license !== OSS_LICENSE)
    throw new ConflictError("license", "value", current.license, OSS_LICENSE);
  if (current.license !== undefined) return [];
  return [
    {
      path: "package.json",
      key: "license",
      mode: "structured-merge",
      before: undefined,
      after: OSS_LICENSE,
    },
  ];
}
