import { expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { bunTesting } from "../src/capabilities.ts";
import { validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { createBlueprint } from "../src/project.ts";
import { runInit, runUpdate } from "./capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

const scripts = {
  test: "bun test --pass-with-no-tests",
  "test:watch": "bun test --watch --pass-with-no-tests",
  "test:coverage": "bun test --coverage --pass-with-no-tests",
};

const update = (directory: Directory) => runUpdate(bunTesting(), directory);

test("Bun init and validate are explicit no-ops, without seeding or executing owner tests", async () => {
  const capability = bunTesting();
  const project = createBlueprint("sample", "", "tester");
  expect(typeof capability.init).not.toBe("function");
  expect(typeof capability.validate).not.toBe("function");
  runInit(capability, project);
  expect(project.packageJson.scripts).toEqual(scripts);
  expect(project.packageJson.devDependencies).toEqual({});
  expect(project.files.size).toBe(0);
  expect(project.templates.map((template) => template.path)).toEqual([]);
  // Any attempt to read the repository must fail; no-op validation needs no I/O.
  const input = mockDirectory();
  input.exists = async () => {
    throw new Error("unexpected repository read");
  };
  const [report] = await validateCapabilities(input, [capability]);
  expect(report?.status).toBe("skipped");
  expect(report && "reason" in report ? report.reason : "").toContain(
    "test workflow",
  );
});

test("Bun update owns only three scripts and preserves owner files and package values", async () => {
  const pkg = {
    name: "owner",
    scripts: {
      test: "custom",
      "test:watch": "custom",
      "test:coverage": "custom",
      "test:unit": "custom",
      build: "custom",
    },
    devDependencies: { owner: "1" },
    dependencies: { keep: "1" },
    custom: { keep: true },
  };
  const input = mockDirectory(
    new Map([
      ["package.json", JSON.stringify(pkg)],
      ["bunfig.toml", "[test]\nroot = './scripts'\n"],
      ["scripts/owner.test.ts", "owner test"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const output = await update(input);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    ...pkg,
    scripts: { ...pkg.scripts, ...scripts },
  });
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await update(output)).toBe(output);
});

test("Bun update creates missing script keys, not a missing package, and preserves matching bytes", async () => {
  const empty = mockDirectory();
  expect(await update(empty)).toBe(empty);
  for (const pkg of [
    {},
    { scripts: { test: "stale", "test:unit": "custom" } },
  ]) {
    const output = await update(
      mockDirectory(new Map([["package.json", JSON.stringify(pkg)]])),
    );
    expect(
      JSON.parse(await output.file("package.json").contents()).scripts,
    ).toMatchObject(scripts);
    const text = JSON.stringify(
      { ...pkg, scripts: { ...pkg.scripts, ...scripts } },
      null,
      4,
    );
    const matching = mockDirectory(new Map([["package.json", text]]));
    expect(await update(matching)).toBe(matching);
    expect(await matching.file("package.json").contents()).toBe(text);
  }
});

test.each([
  "{",
  "null",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"scripts":"bad"}',
  '{"scripts":1}',
  '{"scripts":true}',
])(
  "Bun update rejects unsafe package input before writing: %s",
  async (text) => {
    const input = mockDirectory(new Map([["package.json", text]]));
    await expect(update(input)).rejects.toThrow("package.json");
    expect(await input.file("package.json").contents()).toBe(text);
  },
);

test.each(["library", "tool", "agent-skill"])(
  "%s initializes Bun workflows that accept empty suites, run script tests, and fail broken tests",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
    const root = mkdtempSync(
      join(process.cwd(), ".scratch/tmp_rovo_bun_testing_"),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts).toMatchObject(scripts);
      expect(await module.update(initialized, kind)).toBe(initialized);
      writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
      const run = (script: string) =>
        spawnSync("bun", ["run", script], {
          cwd: root,
          encoding: "utf8",
          timeout: 10_000,
          env: { ...process.env, CI: "true" },
        });
      for (const script of ["test", "test:coverage"]) {
        const result = run(script);
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
      mkdirSync(join(root, "scripts"));
      const path = join(root, "scripts/example.test.ts");
      writeFileSync(
        path,
        'import { expect, test } from "bun:test";\ntest("script", () => expect(1).toBe(1));\n',
      );
      for (const script of ["test", "test:coverage"]) {
        const result = run(script);
        expect(result.status, result.stdout + result.stderr).toBe(0);
        expect(result.stdout + result.stderr).toContain("1 pass");
      }
      writeFileSync(
        path,
        'import { expect, test } from "bun:test";\ntest("broken script", () => expect(1).toBe(2));\n',
      );
      for (const script of ["test", "test:coverage"]) {
        const result = run(script);
        expect(result.status, result.stdout + result.stderr).toBe(1);
        expect(result.stdout + result.stderr).toContain("1 fail");
      }
      const edited = initialized.withNewFile(
        "package.json",
        JSON.stringify({
          ...pkg,
          scripts: { ...pkg.scripts, test: "stale", "test:unit": "custom" },
        }),
      );
      const updated = await module.update(edited, kind);
      expect(
        JSON.parse(await updated.file("package.json").contents()).scripts,
      ).toEqual({ ...pkg.scripts, "test:unit": "custom" });
      expect(await module.update(updated, kind)).toBe(updated);
    } finally {
      rmSync(root, { recursive: true, force: true });
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
