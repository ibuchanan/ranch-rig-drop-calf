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
  dag,
  type File,
  func,
  object,
} from "@dagger.io/dagger";
import { BIOME_TEMPLATE, copyBiome } from "./biome.ts";
import {
  CHANGELOG_TEMPLATE,
  copyChangelog,
  validateChangelog,
} from "./changelog.ts";
import { copyDocs } from "./docs.ts";
import { copyGitHooks, GIT_HOOKS_TEMPLATE } from "./git-hooks.ts";
import { copyGitignoreAssets, PINNED_GITIGNORE } from "./gitignore.ts";
import { mergeScaffoldPackage, scaffoldName } from "./init.ts";
import { nodeContainer as buildNodeContainer } from "./node.ts";
import { copyOssAssets, PINNED_OSS } from "./oss.ts";
import { applyPreclean } from "./preclean.ts";
import { validatePrelint } from "./prelint.ts";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";
import { copySecretsAssets, SECRETS_TEMPLATE } from "./secrets.ts";
import { copyTypeScript, TYPESCRIPT_TEMPLATE } from "./typescript.ts";
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
    let directory = this.copyGitHooks(this.copyTypeScript(rendered));
    directory = this.copyChangelog(directory);
    directory = this.copyDocs(directory);
    // SecretSpec is Forge-app only: no other kind has `forge:*` scripts.
    if (profile === "forge-app")
      directory = await this.copySecrets(directory, name);
    return this.copyGitignore(await this.copyOss(directory, name, owner));
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

  @func()
  async copySecrets(directory: Directory, name: string): Promise<Directory> {
    return copySecretsAssets(
      directory,
      dag.currentModule().source().directory(SECRETS_TEMPLATE),
      name,
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
      dag.currentModule().source().directory(PINNED_OSS),
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

  /**
   * First-time setup of a `forge create` repository: remove the scaffold files
   * Drop Calf replaces, generate the profile's files over what is left, and
   * keep the scaffold's runtime dependencies. The package name defaults to the
   * scaffold's own.
   */
  @func()
  async init(
    directory: Directory,
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
    const scaffold = (await directory.exists("package.json"))
      ? await directory.file("package.json").contents()
      : undefined;
    const cleaned = await applyPreclean(directory);
    const generated = await this.files(
      profile,
      owner,
      packageName ?? scaffoldName(scaffold),
      description,
      author,
      withFunctions,
      withoutFunctions,
      preset,
    );
    const kept = (await cleaned.exists("package.json"))
      ? await cleaned.file("package.json").contents()
      : undefined;
    return cleaned
      .withDirectory(".", generated)
      .withNewFile(
        "package.json",
        mergeScaffoldPackage(
          kept,
          await generated.file("package.json").contents(),
        ),
      );
  }

  /** `init` as a changeset, so deleted scaffold files are deleted on export. */
  @func()
  async initChanges(
    directory: Directory,
    profile: string,
    owner: string,
    packageName?: string,
    description = "",
    author = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Changeset> {
    return (
      await this.init(
        directory,
        profile,
        owner,
        packageName,
        description,
        author,
        withFunctions,
        withoutFunctions,
        preset,
      )
    ).changes(directory);
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
