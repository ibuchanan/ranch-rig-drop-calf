import { type Directory, func, object } from "@dagger.io/dagger";
import { PROFILES, type ProjectProfile } from "./profiles.ts";
import { createBlueprint, renderToDirectory } from "./project.ts";

@object()
export class DropCalf {
  @func()
  files(
    profile: ProjectProfile = "library",
    packageName = "my-package",
    description = "",
    license = "MIT",
    author = "",
  ): Directory {
    const project = createBlueprint(packageName, description, license, author);
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
