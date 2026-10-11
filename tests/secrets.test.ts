import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { buildProject } from "../src/profiles.ts";
import {
  copySecretsAssets,
  SECRETS_ASSETS,
  transformSecretsTemplate,
} from "../src/secrets.ts";
import { secretsTemplates } from "./templates-source.ts";

test("only the project name is derived, and only in the config", () => {
  expect(
    transformSecretsTemplate(
      "secretspec.toml",
      'name = "[project-name]"',
      "sample-app",
    ),
  ).toBe('name = "sample-app"');
  expect(
    transformSecretsTemplate(
      "scripts/env-var.sh",
      "[project-name]\n",
      "sample-app",
    ),
  ).toBe("[project-name]\n");
});

test("the secrets tree seeds the config and executable helpers", async () => {
  const modes = new Map<string, number | undefined>();
  const destination = {
    withNewFile(
      path: string,
      _contents: string,
      options?: { permissions?: number },
    ) {
      modes.set(path, options?.permissions);
      return destination;
    },
  } as unknown as Directory;
  const source = {
    file: (path: string) => ({
      contents: async () => secretsTemplates().get(path) ?? "",
    }),
  } as unknown as Directory;
  await copySecretsAssets(destination, source, "sample-app");
  expect([...modes.keys()].sort()).toEqual([...SECRETS_ASSETS].sort());
  expect(modes.get("scripts/env-var.sh")).toBe(0o755);
  expect(modes.get("scripts/forge-vars-from-secretspec.js")).toBe(0o755);
  expect(modes.get("secretspec.toml")).toBeUndefined();
});

test("Forge app scripts target the CLI through SecretSpec and one allowlist helper", () => {
  const project = buildProject("forge-app", "sample-app", "tester");
  const scripts = project.packageJson.scripts;
  for (const key of [
    "forge:register",
    "forge:deploy",
    "forge:install",
    "forge:uninstall",
    "forge:upgrade",
  ])
    expect(scripts[key]).toStartWith("bash scripts/env-var.sh '");
  expect(scripts["forge:install"]).toContain('"$FORGE_SITE"');
  expect(scripts["forge:variables:set"]).toBe(
    "node scripts/forge-vars-from-secretspec.js",
  );
  // The manual passthrough variants are gone: the allowlist helper is the only
  // way app variables reach Forge.
  expect(scripts["forge:variables:set-encrypted"]).toBeUndefined();
  expect(scripts["forge:variables:set:secretspec"]).toBeUndefined();
  for (const kind of ["library", "tool", "agent-skill"]) {
    const other = buildProject(kind, "sample", "tester").packageJson.scripts;
    expect(other["forge:deploy"]).toBeUndefined();
    expect(other["forge:variables:set"]).toBeUndefined();
  }
});
