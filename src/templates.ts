import type { Directory } from "@dagger.io/dagger";
import { BIOME_TEMPLATE } from "./biome.ts";
import { copySecretsAssets, SECRETS_TEMPLATE } from "./secrets.ts";

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
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    let source = moduleSource.directory(path);
    // EditorConfig remains blueprint-authored until its sources are consolidated.
    if (path === BIOME_TEMPLATE) source = source.withoutFile(".editorconfig");
    result =
      path === SECRETS_TEMPLATE
        ? await copySecretsAssets(result, source, name)
        : copyTemplate(result, source);
  }
  return result;
}
