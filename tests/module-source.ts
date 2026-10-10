import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spyOn } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { PINNED_GITIGNORE } from "../src/gitignore.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { docsTemplates } from "./docs-source.ts";

export const moduleTemplates = () =>
  new Map<string, string>(
    OSS_ASSETS.map((path) => [path, `fixture for ${path}`]),
  );

/** The real pinned template, so tests assemble from the same bytes generation does. */
export const pinnedGitignore = () =>
  readFileSync(join(process.cwd(), PINNED_GITIGNORE), "utf8");

export function mockModuleSource(
  templates: ReadonlyMap<string, string> = moduleTemplates(),
) {
  const docs = docsTemplates();
  const gitignore = pinnedGitignore();
  const source = {
    file: (path: string) => ({
      text: path === PINNED_GITIGNORE ? gitignore : templates.get(path),
      contents: async () =>
        path === PINNED_GITIGNORE ? gitignore : templates.get(path),
    }),
  };
  const docsSource = {
    glob: async () => [...docs.keys()],
    exists: async (path: string) => docs.has(path),
    file: (path: string) => ({
      text: docs.get(path),
      contents: async () => docs.get(path),
    }),
  };
  return spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) =>
        path === "templates/docs" ? docsSource : source,
      file: (path: string) => source.file(path),
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
}
