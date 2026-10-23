import { dag } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { ensureFile } from "../core/files.ts";
import { editPackageJson } from "../core/package-json.ts";
import {
  type PackageManagerOption,
  runScript,
} from "../core/package-manager.ts";
import { templateTree } from "../core/templates.ts";

/** Own release wiring, leaving changelog policy and the shared tool pin with their owners. */
export function release({
  packageManager = "npm",
  library = false,
}: PackageManagerOption & {
  library?: boolean;
} = {}): Capability {
  const checks = ["test", "typecheck", ...(library ? ["pack:check"] : [])]
    .map((check) => runScript(packageManager, check))
    .join(" && ");
  const render = (template: string) =>
    template
      .replace("@CHECK_COMMAND@", runScript(packageManager, "release:check"))
      .replace(
        "@UPDATE_VERSION@",
        packageManager === "npm"
          ? 'bun run --bun npm version "$version" --no-git-tag-version --ignore-scripts --allow-same-version'
          : 'jq --arg version "$version" \'.version = $version\' package.json > "$tmp/package.json"\ncp "$tmp/package.json" package.json',
      )
      .replace(
        "@RELEASE_FILES@",
        `package.json ${packageManager === "npm" ? "package-lock.json " : ""}CHANGELOG.md`,
      );
  return {
    name: "release",
    documentation: {
      tools: [
        {
          name: "git-cliff",
          url: "https://git-cliff.org/",
          purpose:
            "Derives release versions and notes using the changelog capability's shared pin and owner-managed cliff.toml.",
        },
      ],
      init: "Seed release:check and a short, package-manager-specific Bash script that releases main to origin with checks, version and notes updates, commit, tag, and atomic push only on explicit invocation.",
      update:
        "Maintain release and its Bash script; supply a missing release:check while preserving owner checks, versions, lockfiles, notes, and cliff.toml. Never release during maintenance.",
    },
    packageJson: {
      seed: { scripts: { "release:check": checks } },
      policy: { scripts: { release: "bash scripts/release.sh" } },
    },
    init(project) {
      project.templates.push(
        templateTree("templates/release", async (destination, source) =>
          destination.withNewFile(
            "scripts/release.sh",
            render(await source.file("scripts/release.sh").contents()),
          ),
        ),
      );
    },
    async update(directory) {
      if (!(await directory.exists("package.json"))) return directory;
      directory = await editPackageJson(directory, (pkg) => {
        const scripts = (pkg.scripts ?? {}) as Record<string, unknown>;
        if (scripts["release:check"] === undefined)
          pkg.scripts = { ...scripts, "release:check": checks };
      });
      const script = await dag
        .currentModule()
        .source()
        .directory("templates/release")
        .file("scripts/release.sh")
        .contents();
      return ensureFile(directory, "scripts/release.sh", render(script));
    },
    validate: noOp(
      "Git release is an explicit maintainer workflow; standalone validation does not change versions or notes, run checks, commit, tag, or push.",
    ),
  };
}
