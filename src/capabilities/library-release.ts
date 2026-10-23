import { dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { ensureFile } from "../core/files.ts";
import { templateTree } from "../core/templates.ts";

/** Own explicit release commands and helpers, not release policy or tool pins. */
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
      init: "Seed separate release:prepare and release:publish commands and helpers; preparation records reviewed local outputs, while explicit publication checks them and atomically pushes a release commit and tag to the named remote and branch.",
      update:
        "Maintain only release:prepare, release:publish, and their authored helpers; preserve versions, lockfiles, notes, and owner-managed cliff.toml without preparing or publishing a release.",
    },
    packageJson: {
      policy: {
        scripts: {
          "release:prepare": "bun run scripts/release-prepare.ts",
          "release:publish": "bun run scripts/release-publish.ts",
        },
      },
    },
    init(project) {
      project.templates.push(templateTree("templates/library-release"));
    },
    async update(directory) {
      if (!(await directory.exists("package.json"))) return directory;
      for (const path of [
        "scripts/release-prepare.ts",
        "scripts/release-publish.ts",
      ]) {
        const script = await dag
          .currentModule()
          .source()
          .directory("templates/library-release")
          .file(path)
          .contents();
        directory = await ensureFile(directory, path, script);
      }
      return directory;
    },
    validate: noOp(
      "Release preparation and Git publication are explicit maintainer workflows; standalone validation does not bump versions, render release output, commit, tag, or push.",
    ),
  };
}
