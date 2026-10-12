import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { copyTemplate, templateTree } from "./templates.ts";
import { npmTools, REPOSITORY } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** Authored hook commands are seeded once and owner-managed after init. */
export const GIT_HOOKS_TEMPLATE = "templates/git-hooks";
export const GIT_HOOKS_SCRIPTS = {
  prepare: "lefthook install || true",
  lint: "lefthook run lint",
  check: "lefthook run pre-push --force",
} as const;

export function copyGitHooks(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(destination, source);
}

/** Git-hooks alone owns lint; other capabilities contribute named subtasks. */
export function gitHooks(
  lefthookVersion: string = TOOL_VERSIONS.lefthook,
): Capability {
  return {
    name: "git-hooks",
    documentation: {
      tools: [
        {
          name: "Lefthook",
          url: "https://lefthook.dev/",
          purpose:
            "Dispatches lint/check workflows and Git hooks from lefthook.yml.",
        },
        {
          name: "Gitleaks",
          url: "https://github.com/gitleaks/gitleaks",
          purpose:
            "Scans staged changes for secrets in the pre-commit hook; install separately.",
        },
      ],
      init: "Seed Lefthook, prepare/lint/check dispatch scripts, and lefthook.yml.",
      validate:
        "Run lefthook validate with isolated Git metadata; never install or execute hooks.",
    },
    packageJson: {
      seed: { devDependencies: { lefthook: lefthookVersion } },
      policy: {
        scripts: GIT_HOOKS_SCRIPTS,
      },
    },
    init(project) {
      project.templates.push(templateTree(GIT_HOOKS_TEMPLATE));
    },
    update: noOp(
      "Hook configuration is owner-managed after init; its package.json contribution enforces the dispatch scripts and keeps the seeded Lefthook dependency fresh.",
    ),
    validate: (directory) => validateGitHooks(directory, lefthookVersion),
  };
}

/** Tool acceptance only: never install/run hooks or compare against seed policy. */
export async function validateGitHooks(
  directory: Directory,
  lefthookVersion: string = TOOL_VERSIONS.lefthook,
): Promise<Validation> {
  if (!(await directory.exists("lefthook.yml")))
    return { status: "skipped", reason: "lefthook.yml is missing" };
  const container = npmTools(`lefthook@${lefthookVersion}`)
    // Lefthook needs Git metadata even for validate. Keep it outside the read-only
    // mount so source .git files, worktree pointers and hooks cannot be modified.
    .withExec(["git", "init", "/lefthook-worktree"])
    .withEnvVariable("GIT_DIR", "/lefthook-worktree/.git")
    .withEnvVariable("GIT_WORK_TREE", REPOSITORY)
    .withMountedDirectory(REPOSITORY, directory)
    .withWorkdir(REPOSITORY);
  const report = await container
    .withExec(["sh", "-c", 'lefthook validate 2>&1; echo "lefthook exit=$?"'])
    .stdout();
  if (report.trim().match(/lefthook exit=(\d+)$/)?.[1] !== "0")
    throw new Error(`lefthook validation failed: ${report.trim()}`);
  return { status: "validated" };
}
