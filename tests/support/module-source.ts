import { spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  AGENT_SKILL_AIDEV_TEMPLATE,
  AIDEV_TEMPLATE,
  LIBRARY_AIDEV_TEMPLATE,
} from "../../src/capabilities/aidev.ts";
import { BIOME_TEMPLATE } from "../../src/capabilities/biome.ts";
import { BUN_TEMPLATE } from "../../src/capabilities/bun.ts";
import { CATALOG_TEMPLATE } from "../../src/capabilities/catalog.ts";
import { CHANGELOG_TEMPLATE } from "../../src/capabilities/changelog.ts";
import { FORGE_DOCS_TEMPLATE } from "../../src/capabilities/docs.ts";
import { FALLOW_TEMPLATE } from "../../src/capabilities/fallow.ts";
import { GIT_HOOKS_TEMPLATE } from "../../src/capabilities/git-hooks.ts";
import {
  GITIGNORE_TEMPLATE,
  PINNED_GITIGNORE,
} from "../../src/capabilities/gitignore.ts";
import { NODE_TEMPLATE } from "../../src/capabilities/node.ts";
import { OSS_ASSETS } from "../../src/capabilities/oss.ts";
import { SECRETS_TEMPLATE } from "../../src/capabilities/secrets.ts";
import { SKILL_STARTER_TEMPLATE } from "../../src/capabilities/skill-starter.ts";
import {
  TYPESCRIPT_BUN_TEMPLATE,
  TYPESCRIPT_TEMPLATE,
} from "../../src/capabilities/typescript.ts";
import { EVALS_TEMPLATE } from "../../src/core/templates.ts";
import { mockContainer } from "./container-source.ts";
import {
  aidevTemplates,
  biomeTemplates,
  catalogTemplates,
  changelogTemplates,
  docsTemplates,
  fallowTemplates,
  forgeDocsTemplates,
  gitHooksTemplates,
  gitignoreTemplates,
  libraryBuildTemplates,
  nodeTemplates,
  packageCheckTemplates,
  promptfooTemplates,
  releaseTemplates,
  secretsTemplates,
  skillStarterTemplates,
  typescriptBunTemplates,
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
  const files = new Map([
    [PINNED_GITIGNORE, gitignore],
    ...[...gitignoreTemplates()].map(
      ([path, contents]) =>
        [`${GITIGNORE_TEMPLATE}/${path}`, contents] as const,
    ),
    ...[...nodeTemplates()].map(
      ([path, contents]) => [`${NODE_TEMPLATE}/${path}`, contents] as const,
    ),
    ...templates,
  ]);
  const source = mockDirectory(files);
  const trees = new Map<string, ReturnType<typeof mockDirectory>>([
    [AIDEV_TEMPLATE, mockDirectory(aidevTemplates())],
    [LIBRARY_AIDEV_TEMPLATE, mockDirectory(aidevTemplates("library"))],
    [AGENT_SKILL_AIDEV_TEMPLATE, mockDirectory(aidevTemplates("agent-skill"))],
    [CATALOG_TEMPLATE, mockDirectory(catalogTemplates())],
    ["templates/docs", mockDirectory(docs)],
    [FORGE_DOCS_TEMPLATE, mockDirectory(forgeDocsTemplates())],
    [
      BUN_TEMPLATE,
      mockDirectory(
        new Map([
          [
            "bunfig.toml",
            readFileSync(
              join(process.cwd(), BUN_TEMPLATE, "bunfig.toml"),
              "utf8",
            ),
          ],
        ]),
      ),
    ],
    [TYPESCRIPT_TEMPLATE, mockDirectory(typeScript)],
    [TYPESCRIPT_BUN_TEMPLATE, mockDirectory(typescriptBunTemplates())],
    [SKILL_STARTER_TEMPLATE, mockDirectory(skillStarterTemplates())],
    [NODE_TEMPLATE, mockDirectory(nodeTemplates())],
    [BIOME_TEMPLATE, mockDirectory(biome)],
    [FALLOW_TEMPLATE, mockDirectory(fallowTemplates())],
    [CHANGELOG_TEMPLATE, mockDirectory(changelog)],
    [GIT_HOOKS_TEMPLATE, mockDirectory(gitHooks)],
    [SECRETS_TEMPLATE, mockDirectory(secrets)],
    ["templates/vitest", mockDirectory(vitestTemplates())],
    ["templates/library-build", mockDirectory(libraryBuildTemplates())],
    ["templates/package-check", mockDirectory(packageCheckTemplates())],
    ["templates/release", mockDirectory(releaseTemplates())],
    [EVALS_TEMPLATE, mockDirectory(promptfooTemplates())],
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
