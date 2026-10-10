import type { Directory } from "@dagger.io/dagger";
import { copyTemplate, templatePaths } from "./templates.ts";

export function copyDocs(destination: Directory, source: Directory): Directory {
  return copyTemplate(destination, source);
}

export async function docPaths(source: Directory): Promise<string[]> {
  return templatePaths(source);
}
