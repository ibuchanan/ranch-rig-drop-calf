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
import { type Directory, dag, func, object } from "@dagger.io/dagger";
import { EVAL_ASSETS } from "./evals.ts";
import { OSS_ASSETS } from "./oss.ts";
import { planPreclean, UNWANTED } from "./preclean.ts";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";
import { applySync, planSync } from "./sync.ts";
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
    const fallback = project.files.get("biome.json");
    if (fallback) project.files.set("biome.json", localBiomeConfig(fallback));
    return renderToDirectory(project);
  }

  private async precleanPlan(directory: Directory, packageName: string) {
    const paths = [
      "package.json",
      "manifest.yml",
      ...buildProject("forge-app", packageName, "preclean").files.keys(),
      ...UNWANTED,
    ];
    const files = new Map<string, string>();
    for (const path of new Set(paths)) {
      if (await directory.exists(path))
        files.set(path, await directory.file(path).contents());
      if (path !== "manifest.yml" && (await directory.exists(`${path}.old`)))
        files.set(`${path}.old`, "");
    }
    return planPreclean(files, packageName);
  }

  @func()
  async previewPreclean(
    directory: Directory,
    packageName: string,
  ): Promise<string> {
    return JSON.stringify(
      (await this.precleanPlan(directory, packageName)).operations,
      null,
      2,
    );
  }

  @func()
  async preclean(
    directory: Directory,
    packageName: string,
  ): Promise<Directory> {
    const plan = await this.precleanPlan(directory, packageName);
    let result = directory;
    for (const operation of plan.operations) {
      if (operation.action === "rename") {
        result = result.withFile(operation.to, directory.file(operation.path));
      }
      result = result.withoutFile(operation.path);
    }
    return result;
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
    const files = new Map<string, string>();
    for (const path of [
      "package.json",
      "biome.json",
      "lefthook.yml",
      "tsconfig.json",
      "tsconfig.typecheck.json",
      "tsdown.config.ts",
      "cliff.toml",
      "secretspec.toml",
      "scripts/forge-vars-from-secretspec.sh",
      ".nvmrc",
      ".gitignore",
      ".editorconfig",
      ...OSS_ASSETS,
      "DEVELOPMENT.md",
      "AGENTS.md",
      ...EVAL_ASSETS.keys(),
    ]) {
      if (await directory.exists(path))
        files.set(path, await directory.file(path).contents());
    }
    return planSync(
      files,
      profile,
      owner,
      ignoreSets,
      withFunctions,
      withoutFunctions,
      preset,
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
    for (const path of new Set(
      plan.operations.map((operation) => operation.path),
    )) {
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
