import type { Directory } from "@dagger.io/dagger";

// Files supplied by forge create that Drop Calf replaces or regenerates.
export const UNWANTED = [
  "AGENTS.md",
  ".eslintrc",
  "README.md",
  ".gitignore",
  "package-lock.json",
  "yarn.lock",
  "tsconfig.json",
] as const;

export async function applyPreclean(directory: Directory): Promise<Directory> {
  let result = directory;
  for (const path of UNWANTED) {
    if (await result.exists(path)) result = result.withoutFile(path);
  }
  return result;
}
