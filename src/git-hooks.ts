import type { Directory } from "@dagger.io/dagger";
import { type Capability, expandCapability } from "./capability.ts";
import { copyTemplate } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The Git hook workflow: the `lefthook` devDependency, the `prepare`/`lint`/
 * `check` scripts, and the hook config those scripts run.
 *
 * `lefthook.yml` is authored content rather than derived settings: the group
 * names, the individual commands and the gitleaks guard are decisions someone
 * has to be able to read in a diff, so the file is seeded from
 * `templates/git-hooks` instead of being rebuilt by the capability — the same
 * rule the docs, TypeScript and changelog trees follow, which is why
 * `buildProject` carries no `lefthook.yml` for any profile.
 *
 * One config serves every kind. The scripts a kind omits — `test` on
 * `agent-skill`, `size` on `tool`, and the Forge lint steps outside
 * `forge-app` — are reached through `npm run <script> --if-present`, so a hook
 * with nothing to run is a no-op rather than a failure.
 */
export const GIT_HOOKS_TEMPLATE = "templates/git-hooks";

export function copyGitHooks(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(destination, source);
}

/** Every kind installs this runner and drives it through these same scripts. */
export function gitHooks(lefthookVersion = TOOL_VERSIONS.lefthook): Capability {
  return expandCapability("git-hooks", "15-git-hooks", {
    templates: [GIT_HOOKS_TEMPLATE],
    addTo(project) {
      project.packageJson.devDependencies.lefthook = lefthookVersion;
      project.packageJson.scripts.prepare = "lefthook install || true";
      project.packageJson.scripts.lint = "lefthook run lint";
      project.packageJson.scripts.check = "lefthook run pre-push --force";
    },
  });
}
