import { type Directory, dag, func, object } from "@dagger.io/dagger";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { buildProject, resolveProfile } from "./profiles.ts";
import { renderToDirectory } from "./project.ts";

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
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
