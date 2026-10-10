import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spyOn } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { CHANGELOG_TEMPLATE } from "../src/changelog.ts";
import { PINNED_GITIGNORE } from "../src/gitignore.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { TYPESCRIPT_TEMPLATE } from "../src/typescript.ts";
import {
  changelogTemplates,
  docsTemplates,
  typescriptTemplates,
} from "./templates-source.ts";

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
  const typeScript = typescriptTemplates();
  const changelog = changelogTemplates();
  const gitignore = pinnedGitignore();
  const source = {
    file: (path: string) => ({
      text: path === PINNED_GITIGNORE ? gitignore : templates.get(path),
      contents: async () =>
        path === PINNED_GITIGNORE ? gitignore : templates.get(path),
    }),
  };
  const tree = (files: ReadonlyMap<string, string>) => ({
    glob: async () => [...files.keys()],
    exists: async (path: string) => files.has(path),
    file: (path: string) => ({
      text: files.get(path),
      contents: async () => files.get(path),
    }),
  });
  const trees = new Map<string, ReturnType<typeof tree>>([
    ["templates/docs", tree(docs)],
    [TYPESCRIPT_TEMPLATE, tree(typeScript)],
    [CHANGELOG_TEMPLATE, tree(changelog)],
  ]);
  return spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) => trees.get(path) ?? source,
      file: (path: string) => source.file(path),
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
}
