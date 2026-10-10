import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { Directory } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import {
  copySecretsAssets,
  SECRETS_ASSETS,
  transformSecretsTemplate,
} from "../src/secrets.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";
import { secretsTemplates } from "./templates-source.ts";

const secretsPlan = (
  files: ReadonlyMap<string, string>,
  profile = "forge-app",
) =>
  planSync(
    files,
    profile,
    "tester",
    undefined,
    [],
    [],
    undefined,
    secretsTemplates(),
  );

test("the secrets template splits CLI vars from app secrets and requires the site", () => {
  const toml = secretsTemplates().get("secretspec.toml") ?? "";
  // A default site is never assumed: it must be supplied, or a deploy could
  // silently target the wrong tenant.
  expect(toml).toContain(
    'FORGE_SITE = { description = "Forge site hostname, e.g. example.atlassian.net", required = true }',
  );
  expect(toml).toContain("FORGE_PRODUCT = {");
  expect(toml).toContain("FORGE_ENVIRONMENT = {");
  // The app-secret convention is documented where a reader will look.
  expect(toml).toContain("APP_VARIABLE_KEYS");
  // Only the project name is derived.
  expect(toml).toContain("[project-name]");
  expect(
    transformSecretsTemplate("secretspec.toml", toml, "sample-app"),
  ).toContain('name = "sample-app"');
  expect(
    transformSecretsTemplate("scripts/env-var.sh", "untouched\n", "sample-app"),
  ).toBe("untouched\n");
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

test("the env-var helper reads the config by path and records a reason", () => {
  const helper = secretsTemplates().get("scripts/env-var.sh") ?? "";
  expect(helper).toContain(
    'secretspec --file "$root/secretspec.toml" run --provider dotenv --reason "$1" --profile "$profile"',
  );
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

test("Forge sync seeds SecretSpec with the project name and preserves custom files", () => {
  const templates = secretsTemplates();
  const first = applySync(
    secretsPlan(
      new Map([
        [
          "package.json",
          '{"name":"sample-app","scripts":{"custom":"echo safe"}}',
        ],
      ]),
    ),
  ).files;
  expect(first.get("secretspec.toml")).toBe(
    transformSecretsTemplate(
      "secretspec.toml",
      templates.get("secretspec.toml") ?? "",
      "sample-app",
    ),
  );
  expect(first.get("scripts/env-var.sh")).toBe(
    templates.get("scripts/env-var.sh"),
  );
  expect(JSON.parse(first.get("package.json") ?? "").scripts.custom).toBe(
    "echo safe",
  );
  expect(secretsPlan(first).operations).toEqual([]);

  // Non-Forge kinds never receive the tree.
  const tool = applySync(
    secretsPlan(new Map([["package.json", '{"name":"sample"}']]), "tool"),
  ).files;
  expect(tool.has("secretspec.toml")).toBe(false);

  // A file the project has edited is left alone.
  first.set("secretspec.toml", "# custom config\n");
  expect(secretsPlan(first).operations).toEqual([]);
  expect(first.get("secretspec.toml")).toBe("# custom config\n");

  // A conflicting owned script stops before any change.
  const conflicting = new Map([
    [
      "package.json",
      '{"name":"sample-app","scripts":{"forge:deploy":"custom deploy"}}',
    ],
  ]);
  expect(() => secretsPlan(conflicting)).toThrow(ConflictError);
  expect(conflicting.get("package.json")).toContain("custom deploy");
});

test("the allowlist helper pushes only declared keys encrypted and never prints values", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_secrets_"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    const helper = (
      secretsTemplates().get("scripts/forge-vars-from-secretspec.js") ?? ""
    ).replace(
      "const APP_VARIABLE_KEYS = [];",
      'const APP_VARIABLE_KEYS = ["API_SECRET", "PUBLIC_KEY"];',
    );
    const script = join(root, "scripts/forge-vars-from-secretspec.js");
    writeFileSync(script, helper);
    writeFileSync(
      join(root, "bin/secretspec"),
      '#!/bin/sh\nprintf \'%s\\n\' \'{"FORGE_ENVIRONMENT":"staging","API_SECRET":"sensitive-value","PUBLIC_KEY":"public-value"}\'\n',
    );
    chmodSync(join(root, "bin/secretspec"), 0o755);
    writeFileSync(
      join(root, "bin/forge"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\n',
    );
    chmodSync(join(root, "bin/forge"), 0o755);
    const output = execFileSync("node", [script], {
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        CALLS: join(root, "calls"),
      },
      encoding: "utf8",
    });
    expect(output).not.toContain("sensitive-value");
    const calls = readFileSync(join(root, "calls"), "utf8").trim().split("\n");
    expect(calls).toEqual([
      "variables set API_SECRET sensitive-value --environment staging --encrypt",
      "variables set PUBLIC_KEY public-value --environment staging --encrypt",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the seeded allowlist is empty, so nothing is pushed by default", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_secrets_"));
  try {
    const helper = secretsTemplates().get(
      "scripts/forge-vars-from-secretspec.js",
    );
    const script = join(root, "forge-vars-from-secretspec.js");
    writeFileSync(script, helper ?? "");
    const output = execFileSync("node", [script], { encoding: "utf8" });
    expect(output).toContain("No app-level Forge variables declared");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("doctor reports missing Secretspec and Gitleaks separately without installing", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_doctor_"));
  const path = process.env.PATH;
  try {
    process.env.PATH = root;
    const report = JSON.parse(new DropCalf().doctor("forge-app"));
    expect(report).toContainEqual({ tool: "secretspec", status: "missing" });
    expect(report).toContainEqual({ tool: "gitleaks", status: "missing" });
    writeFileSync(join(root, "secretspec"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(root, "secretspec"), 0o755);
    expect(JSON.parse(new DropCalf().doctor("forge-app"))).toContainEqual({
      tool: "secretspec",
      status: "available",
    });
    expect(JSON.parse(new DropCalf().doctor("tool"))).not.toContainEqual({
      tool: "secretspec",
      status: "missing",
    });
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});
