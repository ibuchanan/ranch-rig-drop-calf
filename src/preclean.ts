import type { Directory } from "@dagger.io/dagger";
import { PACKAGE_JSON, stripScaffold } from "./package-json.ts";

// Files supplied by forge create that Drop Calf replaces or regenerates.
export const UNWANTED = [
  "AGENTS.md",
  ".eslintrc",
  "README.md",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
] as const;

export async function applyPreclean(directory: Directory): Promise<Directory> {
  let result = directory;
  for (const path of UNWANTED) {
    if (await result.exists(path)) result = result.withoutFile(path);
  }
  if (await result.exists(PACKAGE_JSON)) {
    const contents = await result.file(PACKAGE_JSON).contents();
    const cleaned = stripScaffold(contents);
    if (cleaned !== contents)
      result = result.withNewFile(PACKAGE_JSON, cleaned);
  }
  return result;
}
