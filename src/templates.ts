import type { Directory } from "@dagger.io/dagger";

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
