import type { Directory } from "@dagger.io/dagger";
import { type Capability, expandCapability } from "./capability.ts";
import { nodeContainer } from "./node.ts";
import { copyTemplate } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The release workflow: the `git-cliff` devDependency, the command that renders
 * an unreleased changelog, and the release policy that command reads.
 *
 * The policy is authored content rather than derived settings. Its Tera header,
 * its commit groups and the preprocessor that strips an Atlassian ticket
 * suffix are decisions someone has to be able to read in a diff, so the file
 * is seeded from `templates/changelog` instead of being rebuilt by the
 * capability — the same rule the docs and TypeScript trees follow, which is
 * why `buildProject` carries neither of these files for any profile.
 *
 * `CHANGELOG.md` is seeded too, but it is the one file here that is *output*
 * rather than input: the command regenerates it whole from `cliff.toml` and
 * the commit history. That is why the prose lives in the policy's `header` and
 * not in the Markdown — a sentence written into the seed would be erased by
 * the next run. The seed exists so a project starts with a changelog on disk
 * rather than an empty one, and it is byte-identical to what the command
 * renders before any new commits, so that first run is a no-op.
 */
export const CHANGELOG_TEMPLATE = "templates/changelog";

/** The policy the command reads; also what "has a release workflow" means. */
export const CHANGELOG_CONFIG = "cliff.toml";

/**
 * The seeded changelog, and the policy. `--output` rather than `--prepend`:
 * git-cliff stacks prepended entries above the file's title and duplicates
 * them on every run, whereas regenerating is idempotent.
 */
/**
 * The command `changelogToolchain` scripts and `validateChangelog` runs.
 * Validation splits it rather than repeating it, so the two cannot drift.
 */
export const CHANGELOG_COMMAND = `git cliff --config ${CHANGELOG_CONFIG} --unreleased -o CHANGELOG.md`;

/** The marker `validateChangelog` looks for after the command it ran. */
const EXIT_MARKER = "git-cliff exit=";

const REPOSITORY = "/repo";

export function copyChangelog(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(destination, source);
}

/** Every kind that releases installs this tool and renders through this command. */
export function changelogToolchain(
  cliffVersion = TOOL_VERSIONS.gitCliff,
): Capability {
  return expandCapability(
    "changelog",
    "14-changelog",
    {
      templates: [CHANGELOG_TEMPLATE],
      addTo(project) {
        project.packageJson.devDependencies["git-cliff"] = cliffVersion;
        project.packageJson.scripts.changelog = CHANGELOG_COMMAND;
      },
    },
    validateChangelog,
  );
}

export type ChangelogValidation =
  | { status: "validated" }
  | { status: "skipped"; reason: string };

/**
 * Validate a repository's release command without changing its files.
 *
 * git-cliff is installed in a container at the version `changelogToolchain`
 * pins, so the verdict depends on the policy under review rather than on
 * whatever the host happens to have installed. The command writes
 * `CHANGELOG.md`, but only inside that throwaway container: the `Directory`
 * passed in is immutable, so the caller's repository is never touched.
 */
export async function validateChangelog(
  directory: Directory,
): Promise<ChangelogValidation> {
  if (!(await directory.exists(CHANGELOG_CONFIG)))
    return { status: "skipped", reason: `${CHANGELOG_CONFIG} is missing` };
  const container = nodeContainer()
    .withExec([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `git-cliff@${TOOL_VERSIONS.gitCliff}`,
    ])
    // A mounted repository belongs to whoever cloned it, so git would refuse
    // to read it as "dubious ownership" without this.
    .withExec(["git", "config", "--global", "--add", "safe.directory", "*"])
    .withMountedDirectory(REPOSITORY, directory)
    .withWorkdir(REPOSITORY);
  // A repository with no commits has no `HEAD` to count, which is a skip
  // rather than a failure, so the probe is allowed to fail quietly.
  const history = await container
    .withExec(["sh", "-c", "git rev-list --count HEAD 2>/dev/null || true"])
    .stdout();
  if (!history.trim().match(/^[1-9]\d*$/))
    return { status: "skipped", reason: "Git history is unavailable" };
  // `echo` runs last so the command's own exit code survives without failing
  // the exec, and `2>&1` carries git-cliff's own diagnosis into the report: a
  // broken policy is reported here, not as a Dagger exec error.
  const report = await container
    .withExec([
      "sh",
      "-c",
      `${CHANGELOG_COMMAND} 2>&1; echo "${EXIT_MARKER}$?"`,
    ])
    .stdout();
  const code = report.trim().match(/git-cliff exit=(\d+)$/)?.[1];
  if (code !== "0")
    throw new Error(`git-cliff validation failed: ${report.trim()}`);
  return { status: "validated" };
}
