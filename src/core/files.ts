import type { Directory } from "@dagger.io/dagger";

/** The file's contents, or undefined when it does not exist. */
export async function readOptionalFile(
  directory: Directory,
  path: string,
): Promise<string | undefined> {
  return (await directory.exists(path))
    ? await directory.file(path).contents()
    : undefined;
}

/** The first of `paths` that exists, in the order given. */
export async function firstExisting(
  directory: Directory,
  paths: readonly string[],
): Promise<string | undefined> {
  const present = await Promise.all(
    paths.map(async (path) => ((await directory.exists(path)) ? path : "")),
  );
  return present.find(Boolean);
}

/**
 * Write `wanted` at `path` unless it is already there byte for byte (and, when
 * `permissions` is given, already has exactly those). Returns the same
 * directory when nothing needs to change.
 */
export async function ensureFile(
  directory: Directory,
  path: string,
  wanted: string,
  options?: { permissions?: number },
): Promise<Directory> {
  const stale =
    (await readOptionalFile(directory, path)) !== wanted ||
    (options?.permissions !== undefined &&
      (await directory.stat(path).permissions()) !== options.permissions);
  return stale ? directory.withNewFile(path, wanted, options) : directory;
}

/** Copy `path` from `source` into `destination` when `source` has it. */
export async function carryFile(
  destination: Directory,
  source: Directory,
  path: string,
): Promise<Directory> {
  const contents = await readOptionalFile(source, path);
  return contents === undefined
    ? destination
    : destination.withNewFile(path, contents);
}
