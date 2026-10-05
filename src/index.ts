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
  async previewSync(directory: Directory, profile: string): Promise<string> {
    return JSON.stringify(
      (await this.syncPlan(directory, profile)).operations,
      null,
      2,
    );
  }

  private async syncPlan(directory: Directory, profile: string) {
    resolveProfile(profile);
    const files = new Map<string, string>();
    if (await directory.exists("package.json")) {
      files.set(
        "package.json",
        await directory.file("package.json").contents(),
      );
    }
    return planSync(files, profile);
  }

  @func()
  async sync(directory: Directory, profile: string): Promise<Directory> {
    const plan = await this.syncPlan(directory, profile);
    if (plan.operations.length === 0) return directory;
    const contents = applySync(plan).files.get("package.json");
    if (contents === undefined)
      throw new Error("sync: package.json missing after apply");
    return directory.withNewFile("package.json", contents);
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
