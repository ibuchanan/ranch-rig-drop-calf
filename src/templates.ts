import type { Directory } from "@dagger.io/dagger";

export type TemplateSeed = {
  path: string;
  seed(
    destination: Directory,
    moduleSource: Directory,
  ): Directory | Promise<Directory>;
};

/** Seed an authored tree; the default is a plain overlay, and specialized policy belongs to its capability. */
export function templateTree(
  path: string,
  copy: (
    destination: Directory,
    source: Directory,
  ) => Directory | Promise<Directory> = (destination, source) =>
    destination.withDirectory(".", source),
): TemplateSeed {
  return {
    path,
    seed: (destination, moduleSource) =>
      copy(destination, moduleSource.directory(path)),
  };
}

/** Execute capability-declared seeds in profile order without knowing their policies. */
export async function seedTemplates(
  destination: Directory,
  moduleSource: Directory,
  templates: readonly TemplateSeed[],
): Promise<Directory> {
  let result = destination;
  for (const template of templates)
    result = await template.seed(result, moduleSource);
  return result;
}
