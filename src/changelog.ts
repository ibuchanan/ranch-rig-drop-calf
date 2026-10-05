import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Capability } from "./capabilities.ts";
import { TOOL_VERSIONS } from "./versions.ts";

// Authored release policy, bundled with the module so generation needs no vendor checkout.
export const CLIFF_CONFIG = `# git-cliff release policy (v1)
[changelog]
body = """
{% if version %}## [{{ version | trim_start_matches(pat="v") }}] - {{ timestamp | date(format="%Y-%m-%d") }}
{% else %}## [unreleased]
{% endif %}
{% for group, commits in commits | group_by(attribute="group") %}
### {{ group | striptags | trim | upper_first }}
{% for commit in commits %}- {% if commit.scope %}*({{ commit.scope }})* {% endif %}{{ commit.message | upper_first }}
{% endfor %}
{% endfor %}
"""
trim = true
render_always = true

[git]
conventional_commits = true
filter_unconventional = true
commit_parsers = [
  { message = "^feat", group = "Features" },
  { message = "^fix", group = "Bug Fixes" },
  { message = "^doc", group = "Documentation" },
  { message = "^perf", group = "Performance" },
  { message = "^refactor", group = "Refactoring" },
  { message = "^test", group = "Testing" },
  { message = "^chore\\\\(release\\\\): prepare for", skip = true },
  { message = "^chore|^ci", group = "Maintenance" },
  { message = "^revert", group = "Reverts" },
]
filter_commits = false
sort_commits = "oldest"
`;

export type ChangelogValidation =
  | { status: "validated" }
  | { status: "skipped"; reason: string };

/** Validate an installed project's release command without changing its files. */
export function validateChangelog(root: string): ChangelogValidation {
  if (!existsSync(join(root, "cliff.toml")))
    return { status: "skipped", reason: "cliff.toml is missing" };
  try {
    const top = execFileSync(
      "git",
      ["-C", root, "rev-parse", "--show-toplevel"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    if (
      realpathSync(top) !== realpathSync(root) ||
      !execFileSync("git", ["-C", root, "rev-list", "--count", "HEAD"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })
        .trim()
        .match(/^[1-9]\d*$/)
    )
      return { status: "skipped", reason: "Git history is unavailable" };
  } catch {
    return { status: "skipped", reason: "Git history is unavailable" };
  }
  const bin = join(root, "node_modules", ".bin", "git-cliff");
  if (!existsSync(bin))
    return { status: "skipped", reason: "git-cliff is not installed locally" };
  try {
    execFileSync("git", ["cliff", "--config", "cliff.toml", "--unreleased"], {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}`,
      },
      stdio: "ignore",
      timeout: 30_000,
    });
  } catch (error) {
    throw new Error(`git-cliff validation failed: ${String(error)}`);
  }
  return { status: "validated" };
}

export function changelog(): Capability {
  return {
    addTo(project) {
      project.packageJson.devDependencies["git-cliff"] = TOOL_VERSIONS.gitCliff;
      project.packageJson.scripts.changelog =
        "git cliff --config cliff.toml --unreleased";
      project.files.set("cliff.toml", CLIFF_CONFIG);
    },
  };
}
