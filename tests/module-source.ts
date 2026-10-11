import { spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dag } from "@dagger.io/dagger";
import { BIOME_TEMPLATE } from "../src/biome.ts";
import { CHANGELOG_TEMPLATE } from "../src/changelog.ts";
import { GIT_HOOKS_TEMPLATE } from "../src/git-hooks.ts";
import { PINNED_GITIGNORE } from "../src/gitignore.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { SECRETS_TEMPLATE } from "../src/secrets.ts";
import { TYPESCRIPT_TEMPLATE } from "../src/typescript.ts";
import {
  biomeTemplates,
  changelogTemplates,
  docsTemplates,
  gitHooksTemplates,
  secretsTemplates,
  typescriptTemplates,
  vitestTemplates,
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
  const biome = biomeTemplates();
  const gitHooks = gitHooksTemplates();
  const secrets = secretsTemplates();
  const gitignore = pinnedGitignore();
  const source = {
    file: (path: string) => ({
      text: path === PINNED_GITIGNORE ? gitignore : templates.get(path),
      contents: async () =>
        path === PINNED_GITIGNORE ? gitignore : templates.get(path),
    }),
  };
  const tree = (files: ReadonlyMap<string, string>) => ({
    files,
    withoutFile: (path: string) =>
      tree(new Map([...files].filter(([name]) => name !== path))),
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
    [BIOME_TEMPLATE, tree(biome)],
    [CHANGELOG_TEMPLATE, tree(changelog)],
    [GIT_HOOKS_TEMPLATE, tree(gitHooks)],
    [SECRETS_TEMPLATE, tree(secrets)],
    ["templates/vitest", tree(vitestTemplates())],
  ]);
  return spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) => trees.get(path) ?? source,
      file: (path: string) => source.file(path),
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
}
