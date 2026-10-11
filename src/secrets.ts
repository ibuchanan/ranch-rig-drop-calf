import type { Directory } from "@dagger.io/dagger";
import type { Capability } from "./capabilities.ts";

/**
 * The SecretSpec workflow: the `forge:*` scripts every Forge app drives through
 * `secretspec run`, and the config and helpers those scripts read.
 *
 * `secretspec.toml`, `scripts/env-var.sh` and
 * `scripts/forge-vars-from-secretspec.js` are authored content — the CLI-var
 * versus app-secret split, the audit `--reason`, and the app-variable allowlist
 * are decisions someone has to read in a diff — so they are seeded from
 * `templates/secretspec` instead of being rebuilt by the capability. Only the
 * project name is derived, substituted for `[project-name]` the way the OSS
 * templates substitute theirs.
 *
 * Only `forge-app` receives the tree; the capability owns the `forge:*` scripts.
 */
export const SECRETS_TEMPLATE = "templates/secretspec";

export const SECRETS_ASSETS = [
  "secretspec.toml",
  "scripts/env-var.sh",
  "scripts/forge-vars-from-secretspec.js",
] as const;

/** The seeded helpers are meant to be run directly, so they are executable. */
export const SECRETS_EXECUTABLES = [
  "scripts/env-var.sh",
  "scripts/forge-vars-from-secretspec.js",
] as const;

const NAME_PLACEHOLDER = "[project-name]";

export function transformSecretsTemplate(
  path: string,
  contents: string,
  name: string,
): string {
  if (path !== "secretspec.toml") return contents;
  return contents.replaceAll(NAME_PLACEHOLDER, name);
}

export async function copySecretsAssets(
  destination: Directory,
  source: Directory,
  name: string,
  paths: readonly string[] = SECRETS_ASSETS,
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    const contents = transformSecretsTemplate(
      path,
      await source.file(path).contents(),
      name,
    );
    result = result.withNewFile(
      path,
      contents,
      SECRETS_EXECUTABLES.includes(path as (typeof SECRETS_EXECUTABLES)[number])
        ? { permissions: 0o755 }
        : {},
    );
  }
  return result;
}

/** The command a `forge:*` script runs is passed through `env-var.sh` so its
 * `$FORGE_*` variables expand only after SecretSpec injects them. */
function throughEnvVar(command: string): string {
  return `bash scripts/env-var.sh '${command}'`;
}

/**
 * Every Forge app targets the CLI through SecretSpec rather than bare `forge`,
 * so the target values are supplied non-interactively and recorded. The
 * app-level push is one helper that reads its own allowlist, so a key is never
 * sent to Forge by accident.
 */
export function forgeSecrets(): Capability {
  return {
    templates: [SECRETS_TEMPLATE],
    addTo(project) {
      Object.assign(project.packageJson.scripts, {
        "forge:register": throughEnvVar("forge register"),
        "forge:deploy": throughEnvVar(
          'forge deploy --environment "$FORGE_ENVIRONMENT"',
        ),
        "forge:install": throughEnvVar(
          'forge install --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
        ),
        "forge:uninstall": throughEnvVar(
          'forge uninstall --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
        ),
        "forge:upgrade": throughEnvVar(
          'forge install --upgrade --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
        ),
        "forge:variables:set": "node scripts/forge-vars-from-secretspec.js",
      });
    },
  };
}
