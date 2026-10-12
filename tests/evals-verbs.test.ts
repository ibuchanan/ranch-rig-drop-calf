import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { validateCapabilities } from "../src/capability.ts";
import {
  EVALS_CONFIG,
  EVALS_SCRIPTS,
  EVALS_TEMPLATE,
  evals,
} from "../src/evals.ts";
import { DropCalf } from "../src/index.ts";
import { createBlueprint } from "../src/project.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { runInit, runUpdate, verb } from "./capability-fixtures.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { promptfooTemplates } from "./templates-source.ts";

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

test("evals update creates missing scripts but never re-adds removed seed dependencies", async () => {
  const empty = mockDirectory();
  expect(await runUpdate(evals(), empty)).toBe(empty);
  const output = await runUpdate(
    evals(),
    mockDirectory(new Map([["package.json", "{}"]])),
  );
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    scripts: EVALS_SCRIPTS,
  });
  for (const path of promptfooTemplates().keys())
    expect(await output.exists(path)).toBe(false);
});

test("evals update retains matching package bytes and rejects malformed consumed sections before writes", async () => {
  const contents = `${JSON.stringify(
    {
      scripts: EVALS_SCRIPTS,
      devDependencies: { promptfoo: TOOL_VERSIONS.promptfoo },
    },
    null,
    4,
  )}\r\n`;
  const matching = mockDirectory(new Map([["package.json", contents]]));
  expect(await runUpdate(evals(), matching)).toBe(matching);
  for (const text of [
    "{",
    "null",
    "[]",
    '{"scripts":null}',
    '{"scripts":[]}',
    '{"scripts":"wrong"}',
    '{"devDependencies":null}',
    '{"devDependencies":[]}',
    '{"devDependencies":"wrong"}',
  ]) {
    const input = mockDirectory(new Map([["package.json", text]]));
    await expect(runUpdate(evals(), input)).rejects.toThrow("package.json");
    expect(await input.file("package.json").contents()).toBe(text);
  }
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
