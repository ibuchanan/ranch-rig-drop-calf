import { type Directory, ExistsType } from "@dagger.io/dagger";

export function copyDocs(destination: Directory, source: Directory): Directory {
  return destination.withDirectory(".", source);
}

export async function docPaths(source: Directory): Promise<string[]> {
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
