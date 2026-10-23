import { dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { templateTree } from "../core/templates.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export const PACKAGE_CHECK_TEMPLATE = "templates/package-check";
const PACKAGE_CHECK_SCRIPT = "scripts/pack-check.sh";

export function packageCheck(): Capability {
  return {
    name: "package-check",
    documentation: {
      init: "Seed exact checker dependencies and the lifecycle-free tarball checking script; checker configuration remains owner-managed.",
      update:
        "Enforce pack:check and its script; keep existing checker dependencies fresh without re-adding removed tools. Preserve publishing metadata, checker configuration, and hook edits.",
      tools: [
        {
          name: "Publint",
          url: "https://publint.dev/",
          purpose:
            "Checks packed library conventions with warnings treated as errors.",
        },
        {
          name: "Are the Types Wrong?",
          url: "https://arethetypeswrong.github.io/",
          purpose:
            "Checks TypeScript declaration resolution against the consumer package.",
        },
      ],
    },
    packageJson: {
      seed: {
        devDependencies: {
          publint: TOOL_VERSIONS.publint,
          "@arethetypeswrong/cli": TOOL_VERSIONS.attw,
        },
      },
      policy: {
        scripts: { "pack:check": "npm run build && sh scripts/pack-check.sh" },
      },
    },
    init(project) {
      project.templates.push(templateTree(PACKAGE_CHECK_TEMPLATE));
    },
    async update(directory) {
      if (!(await directory.exists("package.json"))) return directory;
      const script = await dag
        .currentModule()
        .source()
        .directory(PACKAGE_CHECK_TEMPLATE)
        .file(PACKAGE_CHECK_SCRIPT)
        .contents();
      if (
        (await directory.exists(PACKAGE_CHECK_SCRIPT)) &&
        (await directory.file(PACKAGE_CHECK_SCRIPT).contents()) === script
      )
        return directory;
      return directory.withNewFile(PACKAGE_CHECK_SCRIPT, script);
    },
    validate: noOp(
      "Package checks require fresh build artifacts and belong to the developer pack:check workflow; standalone validation does not build or inspect stale distributables.",
    ),
  };
}
