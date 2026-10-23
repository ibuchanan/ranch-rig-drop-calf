import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  copySecretsAssets,
  FENCE_RIDER_PACKAGE,
  FORGE_SECRETS_SCRIPTS,
  forgeSecrets,
  SECRETS_ASSETS,
  transformSecretsTemplate,
} from "../../src/capabilities/secrets.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import {
  updateCapabilities,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { verb } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { secretsTemplates } from "../support/templates-source.ts";

test("only the project name is derived, and only in the config", () => {
  expect(
    transformSecretsTemplate(
      "secretspec.toml",
      'name = "[project-name]"',
      "sample-app",
    ),
  ).toBe('name = "sample-app"');
  expect(
    transformSecretsTemplate("other.toml", "[project-name]\n", "sample-app"),
  ).toBe("[project-name]\n");
});

test("the secrets tree seeds only the owner config", async () => {
  const written: string[] = [];
  const destination = {
    withNewFile(path: string) {
      written.push(path);
      return destination;
    },
  } as unknown as Directory;
  const source = {
    file: (path: string) => ({
      contents: async () => secretsTemplates().get(path) ?? "",
    }),
  } as unknown as Directory;
  await copySecretsAssets(destination, source, "sample-app");
  expect(written).toEqual([...SECRETS_ASSETS]);
  expect([...secretsTemplates().keys()]).toEqual(["secretspec.toml"]);
});

test.each(["forge:deploy", "forge:install", "forge:upgrade"])(
  "%s runs without interactive Forge prompts",
  (script) => {
    const scripts = buildProject("forge-app", "sample-app", "tester")
      .packageJson.scripts;
    expect(scripts[script]).toContain("--non-interactive");
    if (script !== "forge:deploy")
      expect(scripts[script]).toContain("--confirm-scopes");
  },
);

test.each(["forge:register", "forge:uninstall", "forge:variables:set"])(
  "%s is left without unsupported non-interactive flags",
  (script) => {
    const scripts = buildProject("forge-app", "sample-app", "tester")
      .packageJson.scripts;
    expect(scripts[script]).not.toContain("--non-interactive");
    expect(scripts[script]).not.toContain("--confirm-scopes");
  },
);

test("Forge app scripts keep the forge:* names and delegate to Fence Rider", () => {
  const project = buildProject("forge-app", "sample-app", "tester");
  const scripts = project.packageJson.scripts;
  expect(scripts["forge:register"]).toBe("forge register");
  expect(scripts["forge:deploy"]).toBe(
    'cmd=$(fence-rider deploy -- --non-interactive) && sh -c "$cmd" sh',
  );
  expect(scripts["forge:install"]).toBe(
    'cmd=$(fence-rider install -- --confirm-scopes --non-interactive) && sh -c "$cmd" sh',
  );
  expect(scripts["forge:upgrade"]).toBe(
    'cmd=$(fence-rider install -- --upgrade --confirm-scopes --non-interactive) && sh -c "$cmd" sh',
  );
  expect(scripts["forge:uninstall"]).toBe(
    'cmd=$(fence-rider uninstall) && sh -c "$cmd" sh',
  );
  expect(scripts["forge:variables:set"]).toBe("fence-rider variables");
  expect(project.packageJson.devDependencies[FENCE_RIDER_PACKAGE]).toBe(
    TOOL_VERSIONS.fenceRider,
  );
  expect(TOOL_VERSIONS.fenceRider).toStartWith("github:");
  for (const kind of ["library", "tool", "agent-skill"]) {
    const other = buildProject(kind, "sample", "tester").packageJson;
    expect(other.scripts["forge:deploy"]).toBeUndefined();
    expect(other.scripts["forge:variables:set"]).toBeUndefined();
    expect(other.devDependencies[FENCE_RIDER_PACKAGE]).toBeUndefined();
  }
});

function secretTemplate(): string {
  const contents = secretsTemplates().get("secretspec.toml");
  if (contents === undefined) throw new Error("Missing secretspec template");
  return transformSecretsTemplate("secretspec.toml", contents, "sample");
}

function seededSecrets() {
  return mockDirectory(new Map([["secretspec.toml", secretTemplate()]]));
}

const VALID_TOML =
  '[project]\nname="owner"\nrevision="1.0"\n[profiles.default]\nAPI_TOKEN={ required=["external"], default="secret-marker" }\n[profiles.default.defaults]\nproviders=["owner"]\n[scopes.runtime]\nsecrets=["API_TOKEN"]\n';

test("update enforces only package scripts and preserves owner files byte-for-byte", async () => {
  const config = "# owner config, even invalid\r\n";
  const input = mockDirectory(
    new Map([
      ["secretspec.toml", config],
      [
        "package.json",
        JSON.stringify({
          scripts: { "forge:deploy": "old", "forge:custom": "keep" },
          custom: true,
        }),
      ],
    ]),
  );
  const output = await updateCapabilities(input, [forgeSecrets()]);
  expect(await output.file("secretspec.toml").contents()).toBe(config);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    scripts: { ...FORGE_SECRETS_SCRIPTS, "forge:custom": "keep" },
    custom: true,
  });
  const again = await updateCapabilities(output, [forgeSecrets()]);
  expect(await again.file("package.json").contents()).toBe(
    await output.file("package.json").contents(),
  );
});

test("fresh composed Forge init/update is unchanged and seeds no helper files", async () => {
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const module = new DropCalf();
    const initialized = await module.init(
      mockDirectory(),
      "forge-app",
      "tester",
      "sample",
    );
    expect(await initialized.exists("secretspec.toml")).toBe(true);
    for (const legacy of [
      "forge-variable-keys.json",
      "scripts/env-var.sh",
      "scripts/forge-vars-from-secretspec.js",
    ])
      expect(await initialized.exists(legacy)).toBe(false);
    expect(await module.update(initialized, "forge-app")).toBe(initialized);
    const validate = verb(forgeSecrets(), "validate");
    expect(await validate(initialized)).toEqual({ status: "validated" });
    const deleted = initialized.withoutFile("secretspec.toml");
    expect(await module.update(deleted, "forge-app")).toBe(deleted);
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test.each(["manifest", "runtime"])(
  "validation accepts owner edits in %s scopes without external execution",
  async (scope) => {
    const input = seededSecrets().withNewFile(
      "secretspec.toml",
      VALID_TOML.replace("[scopes.runtime]", `[scopes.${scope}]`),
    );
    expect(await validateCapabilities(input, [forgeSecrets()])).toEqual([
      { capability: "secrets", status: "validated" },
    ]);
  },
);

test("validation allows Forge CLI keys in manifest scope", async () => {
  const contents = VALID_TOML.replaceAll("API_TOKEN", "FORGE_SITE").replace(
    "[scopes.runtime]",
    "[scopes.manifest]",
  );
  const input = seededSecrets().withNewFile("secretspec.toml", contents);
  expect(await validateCapabilities(input, [forgeSecrets()])).toEqual([
    { capability: "secrets", status: "validated" },
  ]);
});

test.each([
  ["[broken", "invalid TOML"],
  ['[project]\nname="x"\nname="duplicate"', "invalid TOML"],
  ['[project]\nname="x"\nrevision="2.0"', "revision"],
  [
    '[project]\nname="x"\nrevision="1.0"\n[profiles.default]\nAPI_TOKEN="plain"',
    "declaration",
  ],
  ['[project]\nname="x"\nrevision="1.0"', "profiles.default"],
  [`${VALID_TOML}[scopes.manifest]\nsecrets="API_TOKEN"\n`, "array of names"],
  [
    VALID_TOML.replace('secrets=["API_TOKEN"]', 'secrets=["API_TOKEN", 1]'),
    "array of names",
  ],
  [
    VALID_TOML.replace('secrets=["API_TOKEN"]', 'secrets=["defaults"]'),
    "not declared",
  ],
  [
    VALID_TOML.replace('secrets=["API_TOKEN"]', 'secrets=["MISSING"]'),
    "not declared",
  ],
  [
    VALID_TOML.replace(
      "API_TOKEN={",
      'FORGE_SITE={ description="s" }\nAPI_TOKEN={',
    ).replace('secrets=["API_TOKEN"]', 'secrets=["FORGE_SITE"]'),
    "CLI",
  ],
])("validation diagnoses local invalid input %#", async (contents, reason) => {
  const input = seededSecrets().withNewFile("secretspec.toml", contents);
  const result = await validateCapabilities(input, [forgeSecrets()]);
  expect(result[0]).toMatchObject({ status: "failed" });
  expect((result[0] as { reason: string }).reason).toContain(reason);
});

test("validation reports absence and redacts TOML diagnostics", async () => {
  const validate = verb(forgeSecrets(), "validate");
  expect(await validate(mockDirectory())).toEqual({
    status: "skipped",
    reason: "secretspec.toml is missing",
  });
  const result = await validateCapabilities(
    seededSecrets().withNewFile(
      "secretspec.toml",
      'secret="secret-marker" nonsense',
    ),
    [forgeSecrets()],
  );
  expect(JSON.stringify(result)).not.toContain("secret-marker");
});

test("TOML project-name substitution escapes quotes and newlines", async () => {
  const name = 'name"with\\slashes\nand newline';
  const contents = transformSecretsTemplate(
    "secretspec.toml",
    secretsTemplates().get("secretspec.toml") ?? "",
    name,
  );
  const validate = verb(forgeSecrets(), "validate");
  expect(
    await validate(seededSecrets().withNewFile("secretspec.toml", contents)),
  ).toEqual({ status: "validated" });
});
