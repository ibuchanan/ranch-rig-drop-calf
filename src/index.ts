import { type Directory, dag, func, object } from "@dagger.io/dagger";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";
import { applySync, planSync } from "./sync.ts";

@object()
export class DropCalf {
  @func()
  async files(
    profile: string,
    packageName?: string,
    description = "",
    license = "MIT",
    author = "",
    withFunctions: string[] = [],
    withoutFunctions: string[] = [],
    preset?: string,
  ): Promise<Directory> {
    resolveProfile(profile, withFunctions, withoutFunctions, preset);
    const name =
      packageName ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    return renderToDirectory(
      buildProject(
        profile,
        name,
        description,
        license,
        author,
        withFunctions,
        withoutFunctions,
        preset,
      ),
    );
  }

  @func()
  async previewSync(
    directory: Directory,
    profile: string,
    ignoreSets?: string[],
  ): Promise<string> {
    return JSON.stringify(
      (await this.syncPlan(directory, profile, ignoreSets)).operations,
      null,
      2,
    );
  }

  private async syncPlan(
    directory: Directory,
    profile: string,
    ignoreSets?: string[],
  ) {
    resolveProfile(profile);
    const files = new Map<string, string>();
    for (const path of [
      "package.json",
      ".gitignore",
      ".editorconfig",
      "README.md",
      "LICENSE",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "DEVELOPMENT.md",
      ".atlassian/OWNER",
    ]) {
      if (await directory.exists(path))
        files.set(path, await directory.file(path).contents());
    }
    return planSync(files, profile, ignoreSets);
  }

  @func()
  async sync(
    directory: Directory,
    profile: string,
    ignoreSets?: string[],
  ): Promise<Directory> {
    const plan = await this.syncPlan(directory, profile, ignoreSets);
    if (plan.operations.length === 0) return directory;
    const files = applySync(plan).files;
    let result = directory;
    for (const path of new Set(
      plan.operations.map((operation) => operation.path),
    )) {
      const contents = files.get(path);
      if (contents === undefined)
        throw new Error(`sync: ${path} missing after apply`);
      result = result.withNewFile(path, contents);
    }
    return result;
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
