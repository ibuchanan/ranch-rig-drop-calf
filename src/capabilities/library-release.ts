import { dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { templateTree } from "../core/templates.ts";

/** Own the explicit local release command and helper, not release policy or tool pins. */
export function libraryRelease(): Capability {
  return {
    name: "library-release",
    documentation: {
      tools: [
        {
          name: "git-cliff",
          url: "https://git-cliff.org/",
          purpose:
            "Derives release versions and regenerates notes using the changelog capability's shared tool pin and owner-managed policy.",
        },
      ],
      init: "Seed the explicit local release:prepare helper, reusing the changelog capability's git-cliff tool and owner-managed release policy.",
      update:
        "Maintain only release:prepare and its authored helper; preserve versions, lockfiles, release notes, and owner-managed cliff.toml without preparing a release.",
    },
    packageJson: {
      policy: {
        scripts: { "release:prepare": "bun run scripts/release-prepare.ts" },
      },
    },
    init(project) {
      project.templates.push(templateTree("templates/library-release"));
    },
    async update(directory) {
      if (!(await directory.exists("package.json"))) return directory;
      const path = "scripts/release-prepare.ts";
      const script = await dag
        .currentModule()
        .source()
        .directory("templates/library-release")
        .file(path)
        .contents();
      if (
        (await directory.exists(path)) &&
        (await directory.file(path).contents()) === script
      )
        return directory;
      return directory.withNewFile(path, script);
    },
    validate: noOp(
      "Release preparation is an explicit maintainer workflow; standalone validation does not bump versions, render release output, or publish.",
    ),
  };
}
