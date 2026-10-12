import type { Directory } from "@dagger.io/dagger";

export type TemplateSeed = {
  path: string;
  seed(
    destination: Directory,
    moduleSource: Directory,
  ): Directory | Promise<Directory>;
};

/** Plain authored-tree overlay; specialized seed policy belongs to its capability. */
export function copyTemplate(
  destination: Directory,
  source: Directory,
): Directory {
  return destination.withDirectory(".", source);
}

export function templateTree(
  path: string,
  copy: (
    destination: Directory,
    source: Directory,
  ) => Directory | Promise<Directory> = copyTemplate,
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
