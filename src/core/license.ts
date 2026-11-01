import type { Directory } from "@dagger.io/dagger";
import { editPackageJson, readPackageJson } from "./package-json.ts";

/** The license the pinned OSS templates and the catalog seed support. */
export const OSS_LICENSE = "Apache-2.0";

/**
 * Derive `package.json`'s license from a value read elsewhere, such as the
 * catalog annotation. The resolver runs only when a package exists, so a
 * repository without one is a no-op rather than a metadata error. Reading the
 * source stays with the caller: `core/` names no capability.
 */
export async function updatePackageLicense(
  directory: Directory,
  readLicense: () => Promise<string>,
): Promise<Directory> {
  if (!(await readPackageJson(directory))) return directory;
  const license = await readLicense();
  return editPackageJson(directory, (pkg) => {
    pkg.license = license;
  });
}
