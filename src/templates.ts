import type { Directory } from "@dagger.io/dagger";
import { CATALOG_TEMPLATE, type CatalogSeed, copyCatalog } from "./catalog.ts";
import { copyGitignoreAssets, PINNED_GITIGNORE } from "./gitignore.ts";
import { copyOssAssets, PINNED_OSS } from "./oss.ts";
import { copySecretsAssets, SECRETS_TEMPLATE } from "./secrets.ts";
import { copyTypeScript, TYPESCRIPT_TEMPLATE } from "./typescript.ts";

/**
 * Seed a template tree over a rendered directory.
 *
 * Templates live in the module source rather than in the blueprint so authored
 * content stays reviewable in a diff and assembly stays pure. Copying is a
 * plain overlay: a file already in the destination is replaced by the template.
 */
export function copyTemplate(
  destination: Directory,
  source: Directory,
): Directory {
  return destination.withDirectory(".", source);
}

/** Seed selected capability trees; template-specific handling stays at this boundary. */
export async function seedTemplates(
  destination: Directory,
  moduleSource: Directory,
  paths: readonly string[],
  name: string,
  catalogSeed?: CatalogSeed,
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    if (path === PINNED_GITIGNORE) {
      result = await copyGitignoreAssets(result, moduleSource.file(path));
      continue;
    }
    const source = moduleSource.directory(path);
    if (path === CATALOG_TEMPLATE) {
      if (!catalogSeed)
        throw new Error("Catalog template requires seed inputs");
      result = await copyCatalog(result, source, catalogSeed);
    } else if (path === TYPESCRIPT_TEMPLATE) {
      result = copyTypeScript(result, source);
    } else if (path === PINNED_OSS) {
      result = await copyOssAssets(result, source);
    } else {
      result =
        path === SECRETS_TEMPLATE
          ? await copySecretsAssets(result, source, name)
          : copyTemplate(result, source);
    }
  }
  return result;
}
