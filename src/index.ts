import { type Directory, dag, func, object } from "@dagger.io/dagger";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { PROFILES, type ProjectProfile } from "./profiles.ts";
import { createBlueprint, renderToDirectory } from "./project.ts";

@object()
export class DropCalf {
  @func()
  async files(
    profile: ProjectProfile = "library",
    packageName?: string,
    description = "",
    license = "MIT",
    author = "",
  ): Promise<Directory> {
    const name =
      packageName ??
      basename(fileURLToPath(await dag.currentWorkspace().address()));
    const project = createBlueprint(name, description, license, author);
    for (const capability of PROFILES[profile] ?? []) {
      capability.addTo(project);
    }
    return renderToDirectory(project);
  }

  @func()
  async export(directory: Directory, path: string): Promise<string> {
    return await directory.export(path);
  }
}

export { buildReadme } from "./project.ts";
