import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { cleanBuild } from "../src/capabilities.ts";
import { noOpReasons, validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { createBlueprint } from "../src/project.ts";
import { runInit, runUpdate } from "./capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

const command = "rm -rf dist";
const update = (directory: Directory) => runUpdate(cleanBuild(), directory);

test("clean-build init and validate have explicit reasons and do no work", async () => {
  const capability = cleanBuild();
  const project = createBlueprint("sample", "", "tester");
  expect(typeof capability.init).not.toBe("function");
  expect(typeof capability.validate).not.toBe("function");
  runInit(capability, project);
  expect(project.packageJson.scripts).toEqual({ clean: command });
  expect(project.packageJson.devDependencies).toEqual({});
  expect(project.files.size).toBe(0);
  expect(project.templates.map((template) => template.path)).toEqual([]);
  expect(noOpReasons([capability])).toEqual([
    {
      capability: "clean-build",
      verb: "init",
      reason:
        "Clean build owns no files to seed; its package.json contribution supplies the clean script.",
    },
    {
      capability: "clean-build",
      verb: "update",
      reason:
        "Clean build owns no files; its package.json contribution enforces scripts.clean as rm -rf dist and never executes it.",
    },
    {
      capability: "clean-build",
      verb: "validate",
      reason:
        "Clean build owns no configuration with a separate tool-acceptance check; executing the clean script would delete build output and belongs to the clean workflow.",
    },
  ]);
  const input = new Proxy({} as Directory, {
    get() {
      throw new Error("unexpected repository access");
    },
  });
  const [report] = await validateCapabilities(input, [capability]);
  expect(report).toMatchObject({
    capability: "clean-build",
    status: "skipped",
    reason: expect.stringContaining("clean workflow"),
  });
});

test("clean-build update replaces only the owned script without deleting output", async () => {
  const pkg = {
    name: "owner",
    scripts: {
      clean: "owner cleanup",
      "clean:cache": "owner cache cleanup",
      build: "owner build",
    },
    devDependencies: { owner: "1" },
    dependencies: { keep: "1" },
    custom: { keep: true },
  };
  const input = mockDirectory(
    new Map([
      ["package.json", JSON.stringify(pkg)],
      ["dist/nested/index.js", "build output"],
      ["src/index.ts", "owner source"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const output = await update(input);
  const wanted = { ...pkg, scripts: { ...pkg.scripts, clean: command } };
  expect(await output.file("package.json").contents()).toBe(
    sortPackageJson(`${JSON.stringify(wanted, null, 2)}\n`),
  );
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await update(output)).toBe(output);
});

test("clean-build update restores missing script keys, not a missing package", async () => {
  const missing = mockDirectory(new Map([["dist/index.js", "build output"]]));
  expect(await update(missing)).toBe(missing);
  for (const pkg of [
    {},
    { scripts: {} },
    { scripts: { build: "owner build" } },
  ]) {
    const output = await update(
      mockDirectory(new Map([["package.json", JSON.stringify(pkg)]])),
    );
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      ...pkg,
      scripts: { ...pkg.scripts, clean: command },
    });
    expect(await update(output)).toBe(output);
  }
});

test("clean-build update preserves matching package bytes and formatting", async () => {
  const text =
    '{\r\n    "custom": true,\r\n    "scripts": {"clean":"rm -rf dist"},\r\n    "name": "owner"\r\n}';
  const input = mockDirectory(new Map([["package.json", text]]));
  expect(await update(input)).toBe(input);
  expect(await input.file("package.json").contents()).toBe(text);
});

test.each([
  "{",
  "null",
  "[]",
  '"bad"',
  "1",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"scripts":"bad"}',
  '{"scripts":1}',
  '{"scripts":true}',
])(
  "clean-build update rejects unsafe package input before writes: %s",
  async (text) => {
    const input = mockDirectory(new Map([["package.json", text]]));
    const write = spyOn(input, "withNewFile");
    try {
      await expect(update(input)).rejects.toThrow("package.json");
      expect(write).not.toHaveBeenCalled();
      expect(await input.file("package.json").contents()).toBe(text);
    } finally {
      write.mockRestore();
    }
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init and update maintain clean without executing it",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(new Map([["dist/index.js", "build output"]])),
        kind,
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts.clean).toBe(command);
      expect(await initialized.file("dist/index.js").contents()).toBe(
        "build output",
      );
      expect(await module.update(initialized, kind)).toBe(initialized);
      const edited = initialized.withNewFile(
        "package.json",
        JSON.stringify({
          ...pkg,
          scripts: {
            ...pkg.scripts,
            clean: "owner cleanup",
            "clean:cache": "custom",
          },
        }),
      );
      const updated = await module.update(edited, kind);
      expect(
        JSON.parse(await updated.file("package.json").contents()).scripts,
      ).toEqual({
        ...pkg.scripts,
        "clean:cache": "custom",
      });
      expect(await updated.file("dist/index.js").contents()).toBe(
        "build output",
      );
      expect(await module.update(updated, kind)).toBe(updated);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
