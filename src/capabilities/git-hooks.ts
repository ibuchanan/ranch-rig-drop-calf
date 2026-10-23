import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "../core/capability.ts";
import {
  forPackageManager,
  type PackageManagerOption,
  runScript,
} from "../core/package-manager.ts";
import { templateTree } from "../core/templates.ts";
import { npmTools, REPOSITORY } from "../core/tool-run.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

/** Authored hook commands are seeded once and owner-managed after init. */
export const GIT_HOOKS_TEMPLATE = "templates/git-hooks";
export const GIT_HOOKS_SCRIPTS = {
  prepare: "lefthook install || true",
  check: "lefthook run pre-push --force",
} as const;

/** Git-hooks owns prepare/check; composition selects build-on-prepare. */
export function gitHooks({
  buildOnPrepare = false,
  packageManager = "npm",
}: PackageManagerOption & { buildOnPrepare?: boolean } = {}): Capability {
  return {
    name: "git-hooks",
    documentation: {
      tools: [
        {
          name: "Lefthook",
          url: "https://lefthook.dev/",
          purpose:
            "Dispatches the check workflow and Git hooks from lefthook.yml.",
        },
        {
          name: "Gitleaks",
          url: "https://github.com/gitleaks/gitleaks",
          purpose:
            "Scans staged changes for secrets in the pre-commit hook; install separately.",
        },
      ],
      init: buildOnPrepare
        ? "Seed Lefthook, build-before-hooks prepare, check dispatch script, and lefthook.yml."
        : "Seed Lefthook, prepare/check dispatch scripts, and lefthook.yml.",
      validate:
        "Run lefthook validate with isolated Git metadata; never install or execute hooks.",
    },
    packageJson: {
      seed: { devDependencies: { lefthook: TOOL_VERSIONS.lefthook } },
      policy: {
        scripts: {
          ...GIT_HOOKS_SCRIPTS,
          prepare: buildOnPrepare
            ? `${runScript(packageManager, "build")} && (${GIT_HOOKS_SCRIPTS.prepare})`
            : GIT_HOOKS_SCRIPTS.prepare,
        },
      },
    },
    init(project) {
      project.templates.push(
        templateTree(GIT_HOOKS_TEMPLATE, async (destination, source) => {
          const contents = await source.file("lefthook.yml").contents();
          return destination.withNewFile(
            "lefthook.yml",
            forPackageManager(contents, packageManager),
          );
        }),
      );
    },
    update: noOp(
      "Hook configuration is owner-managed after init; its package.json contribution enforces the dispatch scripts and keeps the seeded Lefthook dependency fresh.",
    ),
    validate: validateGitHooks,
  };
}

/** Tool acceptance only: never install/run hooks or compare against seed policy. */
async function validateGitHooks(directory: Directory): Promise<Validation> {
  if (!(await directory.exists("lefthook.yml")))
    return { status: "skipped", reason: "lefthook.yml is missing" };
  const container = npmTools(`lefthook@${TOOL_VERSIONS.lefthook}`)
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
