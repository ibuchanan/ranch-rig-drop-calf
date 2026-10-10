import { type Directory, ExistsType } from "@dagger.io/dagger";

/**
 * Seed a template tree over a rendered directory, and list the files it
 * contains so `sync` can seed the ones a repository is missing.
 *
 * Templates live in the module source rather than in the blueprint so authored
 * content stays reviewable in a diff and assembly stays pure. Copying is a
 * plain overlay: a file the user already has is left alone here and reconciled
 * by the owning function instead.
 */
export function copyTemplate(
  destination: Directory,
  source: Directory,
): Directory {
  return destination.withDirectory(".", source);
}

export async function templatePaths(source: Directory): Promise<string[]> {
  const paths = await source.glob("**/*");
  const files = await Promise.all(
    paths.map(async (path) =>
      (await source.exists(path, { expectedType: ExistsType.RegularType }))
        ? path
        : undefined,
    ),
  );
  return files.filter((path): path is string => path !== undefined).sort();
}
