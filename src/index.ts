import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  type Changeset,
  type Container,
  type Directory,
  type File,
  dag,
  func,
  object,
} from "@dagger.io/dagger";
import {
  CHANGELOG_ASSETS,
  CHANGELOG_TEMPLATE,
  changelogPaths,
  copyChangelog,
  validateChangelog,
} from "./changelog.ts";
import { copyDocs, docPaths } from "./docs.ts";
import { EVAL_ASSETS } from "./evals.ts";
import {
  copyGitHooks,
  GIT_HOOKS_ASSETS,
  GIT_HOOKS_TEMPLATE,
  gitHooksPaths,
} from "./git-hooks.ts";
import {
  buildGitignore,
  copyGitignoreAssets,
  PINNED_GITIGNORE,
  readPinnedTemplate,
} from "./gitignore.ts";
import { copyOssAssets, OSS_ASSETS } from "./oss.ts";
import { applyPreclean } from "./preclean.ts";
import { validatePrelint } from "./prelint.ts";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";
import { applySync, planSync } from "./sync.ts";
import { nodeContainer as buildNodeContainer } from "./node.ts";
import {
  copyTypeScript,
  TYPESCRIPT_TEMPLATE,
  typescriptPaths,
} from "./typescript.ts";
import { copyBiome, BIOME_TEMPLATE, biomePaths } from "./biome.ts";
import { TOOL_VERSIONS } from "./versions.ts";

function localBiomeConfig(fallback: string): string {
  const binary = join(process.cwd(), "node_modules", ".bin", "biome");
  const version = TOOL_VERSIONS.biome.replace(/^[^\d]*/, "");
  if (!existsSync(binary)) return fallback;
  let temp: string | undefined;
  try {
    const reported = execFileSync(binary, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (
      !new RegExp(`(?:^|\\s)${version.replace(/\./g, "\\.")}$`).test(reported)
    )
      return fallback;
    temp = mkdtempSync(join(process.cwd(), "tmp_rovo_biome_"));
    execFileSync(binary, ["init"], {
      cwd: temp,
      stdio: "ignore",
      timeout: 5000,
    });
    const initialized = JSON.parse(
      readFileSync(join(temp, "biome.json"), "utf8"),
    );
    if (initialized?.$schema !== JSON.parse(fallback).$schema) return fallback;
    const required = JSON.parse(fallback);
    const merge = (
      target: Record<string, unknown>,
      source: Record<string, unknown>,
    ) => {
      for (const [key, value] of Object.entries(source)) {
        if (
          value !== null &&
          typeof value === "object" &&
          !Array.isArray(value)
        ) {
          const current = target[key];
          target[key] = merge(
            current !== null &&
              typeof current === "object" &&
              !Array.isArray(current)
              ? (current as Record<string, unknown>)
              : {},
            value as Record<string, unknown>,
          );
        } else target[key] = value;
      }
      return target;
    };
    return `${JSON.stringify(merge(initialized, required), null, 2)}\n`;
  } catch {
    return fallback;
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
  }
}

@object()
export class DropCalf {
  @func()
  doctor(profile: string): string {
    resolveProfile(profile);
    const found = (tool: string) => {
      for (const directory of (process.env.PATH ?? "").split(
        process.platform === "win32" ? ";" : ":",
      )) {
        try {
          accessSync(join(directory, tool), constants.X_OK);
          return true;
        } catch {
          /* keep searching */
        }
      }
      return false;
    };
    return JSON.stringify(
      (profile === "forge-app"
        ? ["forge", "secretspec", "gitleaks", "git"]
        : ["git"]
      ).map((tool) => ({
        tool,
        status: found(tool) ? "available" : "missing",
      })),
    );
  }

  /**
   * The Node baseline as a native Dagger container. Containerized tools run the
   * same major the file pins promise rather than whatever the host has
   * installed.
   */
  @func()
  nodeContainer(): Container {
    return buildNodeContainer();
  }

  /**
   * The pinned gitignore.io response. Reading it through the module source keeps
   * generation deterministic and offline; refresh it with
   * `bun run refresh:gitignore` and review the diff.
   */
  private gitignoreSource(): File {
    return dag.currentModule().source().file(PINNED_GITIGNORE);
  }

  @func()
  async files(
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    author = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    resolveProfile(profile, withFunctions, withoutFunctions, preset);
    const name =
      packageName ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    const project = buildProject(
      profile,
      name,
      owner,
      description,
      author,
      withFunctions,
      withoutFunctions,
      preset,
    );
    const fallback = project.files.get("biome.jsonc");
    if (fallback) project.files.set("biome.jsonc", localBiomeConfig(fallback));
    const rendered = renderToDirectory(project);
    return this.copyGitignore(
      await this.copyOss(
        this.copyDocs(
          await this.copyChangelog(
            this.copyGitHooks(await this.copyTypeScript(rendered)),
          ),
        ),
        name,
        owner,
      ),
    );
  }

  @func()
  copyDocs(directory: Directory): Directory {
    return copyDocs(
      directory,
      dag.currentModule().source().directory("templates/docs"),
    );
  }

  @func()
  copyTypeScript(directory: Directory): Directory {
    return copyTypeScript(
      directory,
      dag.currentModule().source().directory(TYPESCRIPT_TEMPLATE),
    );
  }

  @func()
  copyBiome(directory: Directory): Directory {
    return copyBiome(
      directory,
      dag.currentModule().source().directory(BIOME_TEMPLATE),
    );
  }

  @func()
  copyChangelog(directory: Directory): Directory {
    return copyChangelog(
      directory,
      dag.currentModule().source().directory(CHANGELOG_TEMPLATE),
    );
  }

  @func()
  copyGitHooks(directory: Directory): Directory {
    return copyGitHooks(
      directory,
      dag.currentModule().source().directory(GIT_HOOKS_TEMPLATE),
    );
  }

  /**
   * Render an unreleased changelog for a repository to prove its release policy
   * and its `changelog` script still agree. Reports `skipped` rather than
   * failing when the repository has no history to render.
   */
  @func()
  async validateChangelog(directory: Directory): Promise<string> {
    return JSON.stringify(await validateChangelog(directory), null, 2);
  }

  /**
   * Run a repository through the pinned Forge prelint rules. Reports `skipped`
   * rather than failing when the repository never opted into `lint:prelint`.
   */
  @func()
  async validatePrelint(directory: Directory): Promise<string> {
    return JSON.stringify(await validatePrelint(directory), null, 2);
  }

  @func()
  async copyGitignore(
    directory: Directory,
    sets?: string[],
  ): Promise<Directory> {
    return copyGitignoreAssets(directory, this.gitignoreSource(), sets);
  }

  @func()
  async copyOss(
    directory: Directory,
    name: string,
    owner: string,
  ): Promise<Directory> {
    return copyOssAssets(
      directory,
      dag.currentModule().source().directory("vendor/oss-templates"),
      name,
      owner,
    );
  }

  @func()
  async removeScaffold(directory: Directory): Promise<Directory> {
    return applyPreclean(directory);
  }

  @func()
  async removeScaffoldChanges(directory: Directory): Promise<Changeset> {
    return (await this.removeScaffold(directory)).changes(directory);
  }

  @func()
  async previewSync(
    directory: Directory,
    profile: string,
    owner: string,
    ignoreSets?: string[],
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<string> {
    return JSON.stringify(
      (
        await this.syncPlan(
          directory,
          profile,
          owner,
          ignoreSets,
          withFunctions,
          withoutFunctions,
          preset,
        )
      ).operations,
      null,
      2,
    );
  }

  private async syncPlan(
    directory: Directory,
    profile: string,
    owner: string,
    ignoreSets?: string[],
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ) {
    resolveProfile(profile, withFunctions, withoutFunctions, preset);
    // Built before the conflict pass so an unknown set fails before any work.
    const gitignore = buildGitignore(
      await readPinnedTemplate(this.gitignoreSource()),
      ignoreSets,
    );
    const docs = dag.currentModule().source().directory("templates/docs");
    const docsPaths = await docPaths(docs);
    const files = new Map<string, string>();
    for (const path of [
      "package.json",
      "biome.jsonc",
      ...GIT_HOOKS_ASSETS,
      "tsconfig.json",
      "tsconfig.typecheck.json",
      "tsdown.config.ts",
      // The whole release tree, so an edited `CHANGELOG.md` counts as present
      // and is never reseeded over. Deriving the list keeps the reader and the
      // seeder from drifting apart.
      ...CHANGELOG_ASSETS,
      "secretspec.toml",
      "scripts/forge-vars-from-secretspec.sh",
      ".nvmrc",
      ".npmrc",
      "manifest.yml",
      ".gitignore",
      ".editorconfig",
      ...OSS_ASSETS,
      ...docsPaths,
      "AGENTS.md",
      ...EVAL_ASSETS.keys(),
    ]) {
      if (await directory.exists(path))
        files.set(path, await directory.file(path).contents());
    }
    // Surface conflicts in existing content before asking Dagger for seed assets.
    planSync(
      files,
      profile,
      owner,
      ignoreSets,
      withFunctions,
      withoutFunctions,
      preset,
    );
    const templates = new Map<string, string>([[".gitignore", gitignore]]);
    const missing = OSS_ASSETS.filter((path) => !files.has(path));
    if (missing.length) {
      const source = dag
        .currentModule()
        .source()
        .directory("vendor/oss-templates");
      for (const path of missing)
        templates.set(path, await source.file(path).contents());
    }
    for (const path of docsPaths) {
      if (!files.has(path))
        templates.set(path, await docs.file(path).contents());
    }
    // Every kind seeds its configs from `templates/typescript`, and read them
    // even when the repository already has one: the merge is create-if-absent,
    // so the template is still what decides.
    const typeScript = dag
      .currentModule()
      .source()
      .directory(TYPESCRIPT_TEMPLATE);
    for (const path of await typescriptPaths(typeScript))
      templates.set(path, await typeScript.file(path).contents());
    // Every kind seeds its Biome config from `templates/biome` the same way.
    const biome = dag.currentModule().source().directory(BIOME_TEMPLATE);
    for (const path of await biomePaths(biome))
      templates.set(path, await biome.file(path).contents());
    // The release policy is seeded the same way. `sync` decides whether a kind
    // wants it; this only makes the bytes available for that decision.
    const changelog = dag
      .currentModule()
      .source()
      .directory(CHANGELOG_TEMPLATE);
    for (const path of await changelogPaths(changelog))
      templates.set(path, await changelog.file(path).contents());
    // The hook config is seeded the same way: every kind takes it, and `sync`
    // merges the named commands into whatever the repository already has.
    const gitHooks = dag.currentModule().source().directory(GIT_HOOKS_TEMPLATE);
    for (const path of await gitHooksPaths(gitHooks))
      templates.set(path, await gitHooks.file(path).contents());
    return planSync(
      files,
      profile,
      owner,
      ignoreSets,
      withFunctions,
      withoutFunctions,
      preset,
      templates,
    );
  }

  @func()
  async sync(
    directory: Directory,
    profile: string,
    owner: string,
    ignoreSets?: string[],
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    const plan = await this.syncPlan(
      directory,
      profile,
      owner,
      ignoreSets,
      withFunctions,
      withoutFunctions,
      preset,
    );
    if (plan.operations.length === 0) return directory;
    const files = applySync(plan).files;
    let result = directory;
    const missingOss = plan.operations
      .filter((operation) =>
        OSS_ASSETS.includes(operation.path as (typeof OSS_ASSETS)[number]),
      )
      .map((operation) => operation.path);
    if (missingOss.length) {
      const name = JSON.parse(plan.files.get("package.json") ?? "{}")
        .name as string;
      result = await copyOssAssets(
        result,
        dag.currentModule().source().directory("vendor/oss-templates"),
        name,
        owner,
        missingOss,
      );
    }
    for (const path of new Set(
      plan.operations.map((operation) => operation.path),
    )) {
      if (OSS_ASSETS.includes(path as (typeof OSS_ASSETS)[number])) continue;
      const contents = files.get(path);
      if (contents === undefined)
        throw new Error(`sync: ${path} missing after apply`);
      result = result.withNewFile(
        path,
        contents,
        path === "scripts/forge-vars-from-secretspec.sh"
          ? { permissions: 0o755 }
          : {},
      );
    }
    return result;
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
