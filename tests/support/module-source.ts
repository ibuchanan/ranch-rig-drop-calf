import { spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  AIDEV_TEMPLATE,
  LIBRARY_AIDEV_TEMPLATE,
} from "../../src/capabilities/aidev.ts";
import { BIOME_TEMPLATE } from "../../src/capabilities/biome.ts";
import { CATALOG_TEMPLATE } from "../../src/capabilities/catalog.ts";
import { CHANGELOG_TEMPLATE } from "../../src/capabilities/changelog.ts";
import { FALLOW_TEMPLATE } from "../../src/capabilities/fallow.ts";
import { GIT_HOOKS_TEMPLATE } from "../../src/capabilities/git-hooks.ts";
import { PINNED_GITIGNORE } from "../../src/capabilities/gitignore.ts";
import { OSS_ASSETS } from "../../src/capabilities/oss.ts";
import {
  SECRETS_EXECUTABLES,
  SECRETS_TEMPLATE,
} from "../../src/capabilities/secrets.ts";
import { TYPESCRIPT_TEMPLATE } from "../../src/capabilities/typescript.ts";
import { EVALS_TEMPLATE } from "../../src/core/templates.ts";
import { mockContainer } from "./container-source.ts";
import {
  aidevTemplates,
  biomeTemplates,
  catalogTemplates,
  changelogTemplates,
  docsTemplates,
  fallowTemplates,
  gitHooksTemplates,
  libraryBuildTemplates,
  libraryReleaseTemplates,
  packageCheckTemplates,
  promptfooTemplates,
  secretsTemplates,
  typescriptTemplates,
  vitestTemplates,
} from "./templates-source.ts";

const moduleTemplates = () =>
  new Map<string, string>(
    OSS_ASSETS.map((path) => [path, `fixture for ${path}`]),
  );

/** An immutable in-memory directory at the Dagger SDK boundary. */
export const mockDirectory = (
  files = new Map<string, string>(),
  permissions = new Map<string, number>(),
) => {
  const directory = {
    files,
    permissions,
    glob: async () => [...files.keys()],
    exists: async (path: string) => files.has(path),
    file: (path: string) => ({
      text: files.get(path),
      contents: async () => files.get(path),
    }),
    stat: (path: string) => ({
      permissions: async () => permissions.get(path) ?? 0o644,
    }),
    withoutFile: (path: string) =>
      mockDirectory(
        new Map([...files].filter(([name]) => name !== path)),
        new Map([...permissions].filter(([name]) => name !== path)),
      ),
    withNewFile: (
      path: string,
      contents: string,
      options?: { permissions?: number },
    ) =>
      mockDirectory(
        new Map(files).set(path, contents),
        new Map(permissions).set(path, options?.permissions ?? 0o644),
      ),
    withFile: (path: string, file: { text: string }) =>
      mockDirectory(new Map(files).set(path, file.text), permissions),
    withDirectory: (
      _path: string,
      source: {
        files: ReadonlyMap<string, string>;
        permissions?: ReadonlyMap<string, number>;
      },
    ) =>
      mockDirectory(
        new Map([...files, ...source.files]),
        new Map([...permissions, ...(source.permissions ?? [])]),
      ),
  };
  return directory as unknown as Directory & {
    files: Map<string, string>;
    permissions: Map<string, number>;
  };
};

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
  const tree = (
    files: ReadonlyMap<string, string>,
    permissions = new Map<string, number>(),
  ) => ({
    files,
    permissions,
    withoutFile: (path: string) =>
      tree(
        new Map([...files].filter(([name]) => name !== path)),
        new Map([...permissions].filter(([name]) => name !== path)),
      ),
    glob: async () => [...files.keys()],
    exists: async (path: string) => files.has(path),
    stat: (path: string) => ({
      permissions: async () => permissions.get(path) ?? 0o644,
    }),
    file: (path: string) => ({
      text: files.get(path),
      contents: async () => files.get(path),
    }),
  });
  const secretsPermissions = new Map(
    SECRETS_EXECUTABLES.map((path) => [path, 0o755]),
  );
  const trees = new Map<string, ReturnType<typeof tree>>([
    [AIDEV_TEMPLATE, tree(aidevTemplates())],
    [LIBRARY_AIDEV_TEMPLATE, tree(aidevTemplates("library"))],
    [CATALOG_TEMPLATE, tree(catalogTemplates())],
    ["templates/docs", tree(docs)],
    [TYPESCRIPT_TEMPLATE, tree(typeScript)],
    [BIOME_TEMPLATE, tree(biome)],
    [FALLOW_TEMPLATE, tree(fallowTemplates())],
    [CHANGELOG_TEMPLATE, tree(changelog)],
    [GIT_HOOKS_TEMPLATE, tree(gitHooks)],
    [SECRETS_TEMPLATE, tree(secrets, secretsPermissions)],
    ["templates/vitest", tree(vitestTemplates())],
    ["templates/library-build", tree(libraryBuildTemplates())],
    ["templates/package-check", tree(packageCheckTemplates())],
    ["templates/library-release", tree(libraryReleaseTemplates())],
    [EVALS_TEMPLATE, tree(promptfooTemplates())],
  ]);
  const container = mockContainer();
  const module = spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) => trees.get(path) ?? source,
      file: (path: string) => source.file(path),
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
  return {
    mockRestore() {
      module.mockRestore();
      container.spy.mockRestore();
    },
  };
}
