import type { Capability } from "./capabilities.ts";

const helper = String.raw`#!/usr/bin/env bash
set -euo pipefail

# Only configured uppercase keys in the default profile become Forge variables.
config="$(cd "$(dirname "${"$"}{BASH_SOURCE[0]}")/.." && pwd)/secretspec.toml"
while IFS= read -r name; do
  [[ "$name" == FORGE* ]] && continue
  if ! value="$(printenv "$name")"; then
    printf 'Missing configured variable: %s\n' "$name" >&2
    exit 1
  fi
  set --
  [[ "$name" == *SECRET* ]] && set -- --encrypt
  if ! forge variables set --environment "$FORGE_ENVIRONMENT" "$@" "$name" "$value" >/dev/null 2>&1; then
    printf 'Failed to push variable: %s\n' "$name" >&2
    exit 1
  fi
done < <(awk '
  /^\[profiles\.default\][[:space:]]*$/ { section=1; next }
  /^\[/ { section=0 }
  section && /^[A-Z][A-Z0-9_]*[[:space:]]*=/ {
    key=$0; sub(/[[:space:]]*=.*/, "", key); print key
  }
' "$config")
`;

export function forgeSecrets(): Capability {
  return {
    addTo(project) {
      project.files.set(
        "secretspec.toml",
        `[project]\nname = ${JSON.stringify(project.packageJson.name)}\nrevision = "1.0"\n\n[profiles.default]\nFORGE_SITE = { description = "Forge target site", default = "example.atlassian.net" }\nFORGE_PRODUCT = { description = "Forge target product", default = "jira" }\nFORGE_ENVIRONMENT = { description = "Forge target environment", default = "development" }\n`,
      );
      project.files.set("scripts/forge-vars-from-secretspec.sh", helper);
      Object.assign(project.packageJson.scripts, {
        "forge:register": "secretspec run -- forge register",
        "forge:deploy":
          "secretspec run -- sh -c 'forge deploy --environment \"$FORGE_ENVIRONMENT\"'",
        "forge:install":
          'secretspec run -- sh -c \'forge install --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"\'',
        "forge:uninstall":
          'secretspec run -- sh -c \'forge uninstall --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"\'',
        "forge:upgrade":
          'secretspec run -- sh -c \'forge install --upgrade --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"\'',
        "forge:variables:set":
          'secretspec run -- sh -c \'forge variables set --environment "$FORGE_ENVIRONMENT" "$@"\' --',
        "forge:variables:set-encrypted":
          'secretspec run -- sh -c \'forge variables set --environment "$FORGE_ENVIRONMENT" --encrypt "$@"\' --',
        "forge:variables:set:secretspec":
          "secretspec run -- bash scripts/forge-vars-from-secretspec.sh",
      });
    },
  };
}
