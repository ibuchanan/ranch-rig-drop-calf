import { expect, spyOn, test } from "bun:test";
import { posix } from "node:path";
import { dag } from "@dagger.io/dagger";
import { YAML } from "bun";
import {
  EVALS_CONFIG,
  EVALS_SCRIPTS,
  evals,
} from "../../src/capabilities/evals.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { EVALS_TEMPLATE } from "../../src/core/templates.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit, runUpdate, verb } from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { promptfooTemplates } from "../support/templates-source.ts";

type RovoManifest = {
  modules: { "rovo:agent": { prompt: string }[] };
  resources: { key: string; path: string }[];
};

/** The first YAML snippet in a guide, parsed. */
function yamlSnippet<T>(guide: string | undefined): T | undefined {
  const snippet = guide?.match(/^[ \t]*```yaml\n([\s\S]*?)^[ \t]*```/m)?.[1];
  return snippet === undefined ? undefined : (YAML.parse(snippet) as T);
}

/** Where the agent's `resource:<key>;<file>` prompt reference points, relative to the app. */
function promptPathOf(manifest: RovoManifest): string | undefined {
  const [resourceKey, relativePath = ""] = (
    manifest.modules["rovo:agent"][0]?.prompt ?? ""
  )
    .replace("resource:", "")
    .split(";");
  const resource = manifest.resources.find(({ key }) => key === resourceKey);
  return resource && posix.join(resource.path, relativePath);
}

test("evals documents a Rovo resource that resolves to the prompt used by every case", () => {
  const files = promptfooTemplates();
  const manifest = yamlSnippet<RovoManifest>(
    files.get("docs/how-to/evaluate-rovo-agent.md"),
  );
  expect(manifest).toBeDefined();
  const promptPath = manifest && promptPathOf(manifest);
  expect(promptPath).toBe("prompts/agent-instructions.md");
  expect(files.get(promptPath ?? "")).toBeTruthy();

  const cases = YAML.parse(files.get("test/promptfoo-test.yaml") ?? "") as {
    vars: { agent_instructions: string };
  }[];
  expect(cases.length).toBeGreaterThan(0);
  for (const entry of cases)
    expect(entry.vars.agent_instructions).toBe(`file://${promptPath}`);
  expect(files.has("manifest.yml")).toBe(false);
});

test("evals config wires its prompt variable, test file and fixtures without a Rovo agent", () => {
  const files = promptfooTemplates();
  const config = YAML.parse(files.get("promptfooconfig.yaml") ?? "") as {
    prompts: { raw: string }[];
    providers: string[];
    tests: string[];
  };
  expect(config.prompts[0]?.raw).toContain("{{ agent_instructions }}");
  expect(config.providers.length).toBeGreaterThan(0);
  for (const test of config.tests) {
    expect(test).toStartWith("file://");
    expect(files.has(test.slice("file://".length))).toBe(true);
  }
  const cases = YAML.parse(files.get("test/promptfoo-test.yaml") ?? "") as {
    vars: Record<string, string>;
    assert: unknown[];
  }[];
  expect(cases.length).toBeGreaterThan(0);
  for (const entry of cases) {
    expect(entry.assert.length).toBeGreaterThan(0);
    for (const value of Object.values(entry.vars))
      if (value.startsWith("file://"))
        expect(files.get(value.slice("file://".length))).toBeTruthy();
  }
  expect(files.has("manifest.yml")).toBe(false);
});

test("Forge evals selection and all preset declare the same seed tree without authoring its files", () => {
  const selected = buildProject("forge-app", "sample", "tester", "", ["evals"]);
  const all = buildProject("forge-app", "sample", "tester", "", [], [], "all");
  expect(all.packageJson).toEqual(selected.packageJson);
  expect(all.files).toEqual(selected.files);
  expect(all.templates.map((template) => template.path)).toEqual(
    selected.templates.map((template) => template.path),
  );
  expect(selected.packageJson.scripts).toMatchObject({
    eval: "promptfoo eval",
    view: "promptfoo view",
    test: "vitest run --passWithNoTests",
  });
  expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
  expect(selected.templates.map((template) => template.path)).toContain(
    EVALS_TEMPLATE,
  );
  for (const path of promptfooTemplates().keys())
    expect(selected.files.has(path)).toBe(false);
  expect(selected.files.has("manifest.yml")).toBe(false);

  const ordinary = buildProject("forge-app", "sample", "tester");
  const excluded = buildProject(
    "forge-app",
    "sample",
    "tester",
    "",
    [],
    ["evals"],
    "all",
  );
  expect(excluded.packageJson).toEqual(ordinary.packageJson);
  expect(excluded.files).toEqual(ordinary.files);
  expect(excluded.templates.map((template) => template.path)).toEqual(
    ordinary.templates.map((template) => template.path),
  );
  expect(ordinary.templates.map((template) => template.path)).not.toContain(
    EVALS_TEMPLATE,
  );
  expect(ordinary.packageJson.scripts.eval).toBeUndefined();
  expect(ordinary.packageJson.scripts.view).toBeUndefined();
  expect(ordinary.packageJson.devDependencies.promptfoo).toBeUndefined();
});

test("init seeds every Promptfoo byte only when evals is selected", async () => {
  const moduleSource = mockModuleSource();
  const stub = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    for (const [withFunctions, withoutFunctions, preset, enabled] of [
      [[], [], undefined, false],
      [["evals"], [], undefined, true],
      [[], [], "all", true],
      [[], ["evals"], "all", false],
    ] as const) {
      const result = await new DropCalf().init(
        mockDirectory(),
        "forge-app",
        "tester",
        "sample",
        "",
        [...withFunctions],
        [...withoutFunctions],
        preset,
      );
      for (const [path, content] of promptfooTemplates()) {
        if (enabled) expect(await result.file(path).contents()).toBe(content);
        else expect(await result.exists(path)).toBe(false);
      }
      expect(await result.exists("manifest.yml")).toBe(false);
    }
  } finally {
    stub.mockRestore();
    moduleSource.mockRestore();
  }
});

test("evals init seeds the selected tooling and declares the owner-content tree", () => {
  const project = createBlueprint("sample", "description", "tester");
  const capability = evals();
  if (typeof capability.init !== "function") throw new Error("init required");
  runInit(capability, project);
  expect(project.packageJson.scripts).toMatchObject(EVALS_SCRIPTS);
  expect(project.packageJson.devDependencies.promptfoo).toBe(
    TOOL_VERSIONS.promptfoo,
  );
  expect(project.templates.map((template) => template.path)).toContain(
    EVALS_TEMPLATE,
  );
});

test("evals update owns only the tool and scripts, preserving every edited seed and unrelated field", async () => {
  const files = new Map(
    [...promptfooTemplates()].map(([path]) => [path, `owner edited ${path}\n`]),
  );
  files.set(
    "package.json",
    JSON.stringify({
      name: "owner-name",
      scripts: {
        eval: "owner eval",
        view: "owner view",
        custom: "owner custom",
      },
      devDependencies: { promptfoo: "github:owner/promptfoo", other: "1.2.3" },
      dependencies: { runtime: "4.5.6" },
    }),
  );
  files.set("manifest.yml", "owner manifest\n");
  files.set("bun.lock", "owner lockfile\n");
  const input = mockDirectory(files);
  const before = [...input.files];
  const output = await runUpdate(evals(), input);
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg).toEqual({
    name: "owner-name",
    scripts: { ...EVALS_SCRIPTS, custom: "owner custom" },
    devDependencies: { promptfoo: "github:owner/promptfoo", other: "1.2.3" },
    dependencies: { runtime: "4.5.6" },
  });
  for (const [path, contents] of files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(contents);
  expect([...input.files]).toEqual(before);
  expect(await runUpdate(evals(), output)).toBe(output);
});

test("top-level update requires explicit evals selection, preserves edits and deletions, and never auto-detects", async () => {
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
      "",
      ["evals"],
    );
    const pkg = JSON.parse(await initialized.file("package.json").contents());
    pkg.scripts.eval = "owner eval";
    pkg.scripts.view = "owner view";
    pkg.devDependencies.promptfoo = "owner version";
    let edited = initialized.withNewFile("package.json", JSON.stringify(pkg));
    for (const path of promptfooTemplates().keys())
      edited = edited.withNewFile(path, `owner edited ${path}`);
    const absent = "test/data/page-2.md";
    edited = edited.withoutFile(absent);
    const selections: {
      withFunctions: string[];
      withoutFunctions: string[];
      preset?: string;
      enabled: boolean;
    }[] = [
      { withFunctions: [], withoutFunctions: [], enabled: false },
      {
        withFunctions: [],
        withoutFunctions: ["evals"],
        preset: "all",
        enabled: false,
      },
      { withFunctions: ["evals"], withoutFunctions: [], enabled: true },
      { withFunctions: [], withoutFunctions: [], preset: "all", enabled: true },
    ];
    for (const {
      withFunctions,
      withoutFunctions,
      preset,
      enabled,
    } of selections) {
      const output = await module.update(
        edited,
        "forge-app",
        withFunctions,
        withoutFunctions,
        preset,
      );
      const result = JSON.parse(await output.file("package.json").contents());
      expect(result.scripts.eval).toBe(
        enabled ? EVALS_SCRIPTS.eval : "owner eval",
      );
      expect(result.scripts.view).toBe(
        enabled ? EVALS_SCRIPTS.view : "owner view",
      );
      // Non-semver owner value "owner version" is always preserved per FRESHNESS
      expect(result.devDependencies.promptfoo).toBe("owner version");
      for (const path of promptfooTemplates().keys()) {
        if (path === absent) expect(await output.exists(path)).toBe(false);
        else
          expect(await output.file(path).contents()).toBe(
            `owner edited ${path}`,
          );
      }
      const repeated = await module.update(
        output,
        "forge-app",
        withFunctions,
        withoutFunctions,
        preset,
      );
      expect(await repeated.file("package.json").contents()).toBe(
        await output.file("package.json").contents(),
      );
    }
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("evals validation uses native tool acceptance, not owner package policy or model evaluation", async () => {
  const input = mockDirectory(
    new Map([...promptfooTemplates(), ["package.json", "not consumed"]]),
  );
  const before = [...input.files];
  const { commands, environment, newFiles, mounts, mounted, spy } =
    mockContainer();
  try {
    expect(await validateCapabilities(input, [evals()])).toEqual([
      { capability: "evals", status: "validated" },
    ]);
    expect(commands).toEqual([
      [
        "bun",
        "add",
        "--ignore-scripts",
        `promptfoo@${TOOL_VERSIONS.promptfoo}`,
      ],
      ["bun", "run", "--no-install", "/tools/validate.mjs"],
    ]);
    expect(newFiles["/tools/validate.mjs"]).toContain("commands/validate.js");
    expect(newFiles["/tools/validate.mjs"]).toContain(
      `doValidate({ config: ['/repo/${EVALS_CONFIG}'], envPath: '/dev/null' }, {})`,
    );
    expect(environment).toEqual({
      PROMPTFOO_DISABLE_TELEMETRY: "1",
      PROMPTFOO_DISABLE_UPDATE: "1",
      PROMPTFOO_CONFIG_DIR: "/tmp/promptfoo",
      PROMPTFOO_LOG_DIR: "/tmp/promptfoo/logs",
    });
    expect(mounts).toEqual([{ path: "/repo", readOnly: true }]);
    expect(mounted).toEqual([input]);
    expect([...input.files]).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

test("evals validation skips absent config before installing tools", async () => {
  const spy = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("must not install");
  });
  try {
    const validate = verb(evals(), "validate");
    expect(await validate(mockDirectory())).toEqual({
      status: "skipped",
      reason: `${EVALS_CONFIG} is missing`,
    });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("evals validation reports native config diagnostics without modifying inputs", async () => {
  const input = mockDirectory(new Map([[EVALS_CONFIG, "broken yaml"]]));
  const failure = Object.assign(new Error("exec failed"), {
    stdout: "Failed to validate configuration",
    stderr: "unknown provider",
  });
  const { spy } = mockContainer({ failure });
  try {
    expect(await validateCapabilities(input, [evals()])).toEqual([
      {
        capability: "evals",
        status: "failed",
        reason:
          "evals: validation execution failed: Failed to validate configuration\nunknown provider",
      },
    ]);
    expect(await input.file(EVALS_CONFIG).contents()).toBe("broken yaml");
  } finally {
    spy.mockRestore();
  }
});
