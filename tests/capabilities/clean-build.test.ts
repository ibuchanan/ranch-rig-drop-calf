import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { cleanBuild } from "../../src/capabilities/clean-build.ts";
import {
  noOpReasons,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit, runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

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

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init and update maintain clean without executing it",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const artifacts = new Map([
        ["dist/index.js", "build output"],
        ["node_modules/example/index.js", "installed dependency"],
      ]);
      const initialized = await module.init(
        mockDirectory(artifacts),
        kind,
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts.clean).toBe(
        kind === "library"
          ? "rm -rf node_modules package-lock.json dist"
          : command,
      );
      for (const [path, contents] of artifacts)
        expect(await initialized.file(path).contents()).toBe(contents);
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
      const updated = await module.update(
        edited.withNewFile("package-lock.json", "npm lockfile"),
        kind,
      );
      expect(await updated.file("package-lock.json").contents()).toBe(
        "npm lockfile",
      );
      expect(
        JSON.parse(await updated.file("package.json").contents()).scripts,
      ).toEqual({
        ...pkg.scripts,
        "clean:cache": "custom",
      });
      for (const [path, contents] of artifacts)
        expect(await updated.file(path).contents()).toBe(contents);
      expect(await module.update(updated, kind)).toBe(updated);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
