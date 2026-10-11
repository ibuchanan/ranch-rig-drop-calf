import type { Directory } from "@dagger.io/dagger";
import { copyTemplate } from "./templates.ts";

export function copyDocs(destination: Directory, source: Directory): Directory {
  return copyTemplate(destination, source);
}
