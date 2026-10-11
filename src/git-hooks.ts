import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import { copyTemplate } from "./templates.ts";
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

/** Maintain only the runner pin and dispatch scripts, never the owner's config. */
export async function updateGitHooks(
  directory: Directory,
  lefthookVersion: string = TOOL_VERSIONS.lefthook,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const contents = await directory.file("package.json").contents();
  const pkg = parseObject("package.json", contents);
  let changed = false;
  for (const [section, wanted] of [
    ["devDependencies", { lefthook: lefthookVersion }],
    ["scripts", GIT_HOOKS_SCRIPTS],
  ] as const) {
    const existing = pkg[section];
    if (
      existing !== undefined &&
      (existing === null ||
        typeof existing !== "object" ||
        Array.isArray(existing))
    )
      throw new ParseError("package.json", `${section} must be an object`);
    const fields = (existing ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(wanted)) {
      if (fields[key] === value) continue;
      fields[key] = value;
      changed = true;
    }
    pkg[section] = fields;
  }
  return changed
    ? directory.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      )
    : directory;
}

/** Git-hooks alone owns lint; other capabilities contribute named subtasks. */
export function gitHooks(
  lefthookVersion: string = TOOL_VERSIONS.lefthook,
): Capability {
  const seed: Capability["addTo"] = (project) => {
    project.packageJson.devDependencies.lefthook = lefthookVersion;
    Object.assign(project.packageJson.scripts, GIT_HOOKS_SCRIPTS);
  };
  return {
    name: "git-hooks",
    templates: [GIT_HOOKS_TEMPLATE],
    addTo: seed,
    init(project) {
      seed(project);
      project.templates.push(GIT_HOOKS_TEMPLATE);
    },
    update: (directory) => updateGitHooks(directory, lefthookVersion),
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
  const container = nodeContainer()
    .withExec([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `lefthook@${lefthookVersion}`,
    ])
    // Lefthook needs Git metadata even for validate. Keep it outside the read-only
    // mount so source .git files, worktree pointers and hooks cannot be modified.
    .withExec(["git", "init", "/lefthook-worktree"])
    .withEnvVariable("GIT_DIR", "/lefthook-worktree/.git")
    .withEnvVariable("GIT_WORK_TREE", "/repo")
    .withMountedDirectory("/repo", directory)
    .withWorkdir("/repo");
  const report = await container
    .withExec(["sh", "-c", 'lefthook validate 2>&1; echo "lefthook exit=$?"'])
    .stdout();
  if (report.trim().match(/lefthook exit=(\d+)$/)?.[1] !== "0")
    throw new Error(`lefthook validation failed: ${report.trim()}`);
  return { status: "validated" };
}
