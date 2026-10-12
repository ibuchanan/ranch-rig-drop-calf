import { expect, spyOn, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { type Directory, dag } from "@dagger.io/dagger";
import ts from "typescript";
import { updateCapabilities, validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import {
  copySecretsAssets,
  FORGE_SECRETS_SCRIPTS,
  FORGE_VARIABLE_KEYS,
  forgeSecrets,
  SECRETS_ASSETS,
  SECRETS_EXECUTABLES,
  transformSecretsTemplate,
  updateSecrets,
  validateSecrets,
} from "../src/secrets.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
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

function secretTemplate(path: string): string {
  const contents = secretsTemplates().get(path);
  if (contents === undefined) throw new Error(`Missing template ${path}`);
  return contents;
}

function seededSecrets() {
  const files = secretsTemplates();
  files.set(
    "secretspec.toml",
    transformSecretsTemplate(
      "secretspec.toml",
      secretTemplate("secretspec.toml"),
      "sample",
    ),
  );
  return mockDirectory(
    files,
    new Map(SECRETS_EXECUTABLES.map((path) => [path, 0o755])),
  );
}

test("update preserves owner declarations byte-for-byte and replaces only owned tooling", async () => {
  const source = mockModuleSource();
  try {
    const config = "# owner config, even invalid\r\n";
    const keys = '["API_TOKEN"]\r\n';
    const input = seededSecrets()
      .withNewFile("secretspec.toml", config, { permissions: 0o600 })
      .withNewFile(FORGE_VARIABLE_KEYS, keys, { permissions: 0o600 })
      .withNewFile("scripts/env-var.sh", "# owner wrapper\n")
      .withNewFile("scripts/forge-vars-from-secretspec.js", "// owner code\n")
      .withNewFile(
        "package.json",
        JSON.stringify({
          scripts: { "forge:deploy": "old", "forge:custom": "keep" },
          custom: true,
        }),
      );
    const output = await updateCapabilities(input, [forgeSecrets()]);
    expect(await output.file("secretspec.toml").contents()).toBe(config);
    expect(await output.file(FORGE_VARIABLE_KEYS).contents()).toBe(keys);
    for (const path of ["secretspec.toml", FORGE_VARIABLE_KEYS])
      expect(await output.stat(path).permissions()).toBe(0o600);
    for (const path of SECRETS_EXECUTABLES) {
      expect(await output.file(path).contents()).toBe(secretTemplate(path));
      expect(await output.stat(path).permissions()).toBe(0o755);
    }
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      scripts: { ...FORGE_SECRETS_SCRIPTS, "forge:custom": "keep" },
      custom: true,
    });
    expect(await updateSecrets(output)).toBe(output);
    expect(await input.file("scripts/env-var.sh").contents()).toBe(
      "# owner wrapper\n",
    );
  } finally {
    source.mockRestore();
  }
});

test("fresh composed Forge init/update is unchanged and does not recreate owner files", async () => {
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
    expect(await initialized.file(FORGE_VARIABLE_KEYS).contents()).toBe("[]\n");
    expect(await module.update(initialized, "forge-app")).toBe(initialized);
    expect(await validateSecrets(initialized)).toEqual({ status: "validated" });
    const deleted = initialized
      .withoutFile("secretspec.toml")
      .withoutFile(FORGE_VARIABLE_KEYS);
    expect(await module.update(deleted, "forge-app")).toBe(deleted);
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("update restores a missing helper and executable permissions without seeding owner files", async () => {
  const source = mockModuleSource();
  try {
    const input = seededSecrets()
      .withoutFile(SECRETS_EXECUTABLES[0])
      .withNewFile(
        SECRETS_EXECUTABLES[1],
        secretTemplate(SECRETS_EXECUTABLES[1]),
      );
    const output = await updateSecrets(input);
    for (const path of SECRETS_EXECUTABLES)
      expect(await output.stat(path).permissions()).toBe(0o755);
    expect(await updateSecrets(output)).toBe(output);
    const empty = await updateSecrets(mockDirectory());
    expect(await empty.exists("secretspec.toml")).toBe(false);
    expect(await empty.exists(FORGE_VARIABLE_KEYS)).toBe(false);
    expect(await empty.exists("package.json")).toBe(false);
  } finally {
    source.mockRestore();
  }
});

test.each([
  'const APP_VARIABLE_KEYS = ["API_TOKEN"];',
  "const APP_VARIABLE_KEYS = getKeys();",
  'const APP_VARIABLE_KEYS = []; APP_VARIABLE_KEYS.push("API_TOKEN");',
  'let APP_VARIABLE_KEYS = []; APP_VARIABLE_KEYS = ["API_TOKEN"];',
  'const APP_VARIABLE_KEYS = [/* keep me */ "API_TOKEN",];',
])("legacy owner keys block update before any write: %s", async (helper) => {
  const input = seededSecrets().withNewFile(SECRETS_EXECUTABLES[1], helper);
  const write = spyOn(input, "withNewFile");
  try {
    await expect(updateSecrets(input)).rejects.toThrow(
      `Move the keys to ${FORGE_VARIABLE_KEYS}`,
    );
    expect(write).not.toHaveBeenCalled();
    expect(await input.file(SECRETS_EXECUTABLES[1]).contents()).toBe(helper);
  } finally {
    write.mockRestore();
  }
});

test("empty legacy allowlist is safe to replace, but missing owner JSON is not invented", async () => {
  const source = mockModuleSource();
  try {
    const input = seededSecrets()
      .withoutFile(FORGE_VARIABLE_KEYS)
      .withNewFile(
        SECRETS_EXECUTABLES[1],
        "const APP_VARIABLE_KEYS = []; if (APP_VARIABLE_KEYS.length === 0) {} for (const key of APP_VARIABLE_KEYS) {}",
      );
    const output = await updateSecrets(input);
    expect(await output.file(SECRETS_EXECUTABLES[1]).contents()).toBe(
      secretTemplate(SECRETS_EXECUTABLES[1]),
    );
    expect(await output.exists(FORGE_VARIABLE_KEYS)).toBe(false);
  } finally {
    source.mockRestore();
  }
});

test.each(["{", "null", "[]", '{"scripts":null}', '{"scripts":[]}'])(
  "unsafe package input is rejected before writes: %s",
  async (contents) => {
    const input = seededSecrets().withNewFile("package.json", contents);
    const write = spyOn(input, "withNewFile");
    try {
      await expect(updateSecrets(input)).rejects.toThrow("package.json");
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  },
);

test("validation accepts owner edits without baseline comparisons or external execution", async () => {
  const input = seededSecrets()
    .withNewFile(
      "secretspec.toml",
      '[project]\nname="owner"\nrevision="1.0"\n[profiles.default]\nAPI_TOKEN={ required=["external"], default="secret-marker" }\n[profiles.default.defaults]\nproviders=["owner"]\n',
    )
    .withNewFile(FORGE_VARIABLE_KEYS, '["API_TOKEN"]')
    .withNewFile(SECRETS_EXECUTABLES[0], "# different owner wrapper\n", {
      permissions: 0o700,
    })
    .withNewFile(SECRETS_EXECUTABLES[1], "// different owner helper\n", {
      permissions: 0o700,
    });
  const before = await Promise.all(
    SECRETS_ASSETS.map(async (path) => [
      path,
      await input.file(path).contents(),
    ]),
  );
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("must not execute");
  });
  try {
    expect(await validateCapabilities(input, [forgeSecrets()])).toEqual([
      { capability: "secrets", status: "validated" },
    ]);
    expect(
      await Promise.all(
        SECRETS_ASSETS.map(async (path) => [
          path,
          await input.file(path).contents(),
        ]),
      ),
    ).toEqual(before);
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});

test.each([
  ["secretspec.toml", "[broken", "invalid TOML"],
  ["secretspec.toml", '[project]\nname="x"\nname="duplicate"', "invalid TOML"],
  ["secretspec.toml", '[project]\nname="x"\nrevision="2.0"', "revision"],
  [
    "secretspec.toml",
    '[project]\nname="x"\nrevision="1.0"\n[profiles.default]\nAPI_TOKEN="plain"',
    "declaration",
  ],
  [FORGE_VARIABLE_KEYS, "null", "unique"],
  [FORGE_VARIABLE_KEYS, '["API_TOKEN", "API_TOKEN"]', "unique"],
  [FORGE_VARIABLE_KEYS, '["bad-key"]', "unique"],
  [FORGE_VARIABLE_KEYS, '["FORGE_SITE"]', "CLI"],
  [FORGE_VARIABLE_KEYS, '["API_TOKEN"]', "not declared"],
  [FORGE_VARIABLE_KEYS, "{", "invalid JSON"],
])(
  "validation diagnoses local invalid input %s %s",
  async (path, contents, reason) => {
    if (path === undefined || contents === undefined || reason === undefined)
      throw new Error("Invalid test case");
    const input = seededSecrets().withNewFile(path, contents);
    const result = await validateCapabilities(input, [forgeSecrets()]);
    expect(result[0]).toMatchObject({ status: "failed" });
    expect((result[0] as { reason: string }).reason).toContain(reason);
  },
);

test("validation reports absence, missing helpers, non-executable modes and redacts TOML diagnostics", async () => {
  expect(await validateSecrets(mockDirectory())).toEqual({
    status: "skipped",
    reason: "secretspec.toml is missing",
  });
  for (const path of [FORGE_VARIABLE_KEYS, ...SECRETS_EXECUTABLES])
    await expect(
      validateSecrets(seededSecrets().withoutFile(path)),
    ).rejects.toThrow(`${path} is missing`);
  for (const path of SECRETS_EXECUTABLES)
    await expect(
      validateSecrets(seededSecrets().withNewFile(path, "owner")),
    ).rejects.toThrow("not executable");
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
    secretTemplate("secretspec.toml"),
    name,
  );
  expect(
    await validateSecrets(
      seededSecrets().withNewFile("secretspec.toml", contents),
    ),
  ).toEqual({ status: "validated" });
});

/** Exercise the real template in a sandbox with only the child-process and file boundaries replaced. */
function runPush(
  keys: unknown,
  values: Record<string, string> = {},
  failure?: string,
) {
  const calls: {
    command: string;
    args: string[];
    options: Record<string, unknown>;
  }[] = [];
  const messages: string[] = [];
  const process = { exitCode: 0 };
  const helper = secretTemplate(SECRETS_EXECUTABLES[1]);
  const code = ts.transpileModule(
    helper.replaceAll(
      "import.meta.url",
      '"file:///repo/scripts/forge-vars-from-secretspec.js"',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  runInNewContext(code, {
    exports: {},
    URL,
    process,
    console: {
      log: (message: string) => messages.push(message),
      error: (message: string) => messages.push(message),
    },
    require: (module: string) => {
      if (module === "node:fs")
        return { readFileSync: () => JSON.stringify(keys) };
      if (module === "node:url")
        return { fileURLToPath: (url: URL) => url.pathname };
      if (module === "node:child_process")
        return {
          execFileSync: (
            command: string,
            args: string[],
            options: Record<string, unknown>,
          ) => {
            calls.push({ command, args, options });
            if (command === failure)
              throw new Error("child printed secret-marker");
            return command === "secretspec"
              ? `banner\n${JSON.stringify(values)}\n`
              : "";
          },
        };
      throw new Error(`unexpected import ${module}`);
    },
  });
  return { calls, messages, process };
}

test("push helper defaults to no-op and rejects invalid/CLI keys before secret access", () => {
  expect(runPush([]).calls).toEqual([]);
  for (const keys of [null, ["FORGE_SITE"], ["bad-key"], ["TOKEN", "TOKEN"]]) {
    const result = runPush(keys);
    expect(result.calls).toEqual([]);
    expect(result.process.exitCode).toBe(1);
  }
});

test("push helper uses root paths, a default profile, audit reason and encrypted allowlisted values", () => {
  const result = runPush(["API_TOKEN"], {
    FORGE_ENVIRONMENT: "staging",
    API_TOKEN: "secret-marker",
    OTHER: "not-selected",
  });
  expect(result.process.exitCode).toBe(0);
  expect(result.calls[0]?.args).toContain("/repo/secretspec.toml");
  expect(result.calls[0]?.args).toContain("default");
  expect(result.calls[0]?.args).toContain("--reason");
  expect(result.calls[1]?.args).toEqual([
    "variables",
    "set",
    "API_TOKEN",
    "secret-marker",
    "--environment",
    "staging",
    "--encrypt",
  ]);
  for (const call of result.calls) {
    expect(call.options.cwd).toBe("/repo/");
    expect(call.options.stdio).toEqual(["ignore", "pipe", "pipe"]);
  }
  expect(result.messages.join()).not.toContain("secret-marker");
});

test("push preflights every key and never prints sensitive child-process errors", () => {
  const missing = runPush(["TOKEN", "MISSING"], { TOKEN: "secret-marker" });
  expect(missing.calls.map((call) => call.command)).toEqual(["secretspec"]);
  expect(missing.process.exitCode).toBe(1);
  for (const command of ["secretspec", "forge"]) {
    const failed = runPush(["TOKEN"], { TOKEN: "secret-marker" }, command);
    expect(failed.process.exitCode).toBe(1);
    expect(failed.messages.join()).not.toContain("secret-marker");
  }
});
