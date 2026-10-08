import { afterEach, beforeEach, expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";
import { mockOssSource } from "./oss-source.ts";

let ossSource: ReturnType<typeof mockOssSource>;
beforeEach(() => {
  ossSource = mockOssSource();
});
afterEach(() => {
  ossSource.mockRestore();
});

const suitePaths = [
  "promptfooconfig.yaml",
  "prompts/agent-instructions.md",
  "test/promptfoo-test.yaml",
  "test/data/page-1.md",
];

test("Forge evals selection and all preset generate the same complete starter suite", () => {
  const selected = buildProject("forge-app", "sample", "tester", "", "", [
    "evals",
  ]);
  const all = buildProject(
    "forge-app",
    "sample",
    "tester",
    "",
    "",
    [],
    [],
    "all",
  );
  expect(all).toEqual(selected);
  expect(selected.packageJson.scripts).toMatchObject({
    eval: "promptfoo eval",
    view: "promptfoo view",
    test: "bun test --pass-with-no-tests",
  });
  expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
  for (const path of suitePaths) expect(selected.files.get(path)).toBeTruthy();
  expect(selected.files.get("promptfooconfig.yaml")).toContain(
    "file://test/promptfoo-test.yaml",
  );
  expect(selected.files.get("test/promptfoo-test.yaml")).toContain(
    "file://test/data/page-1.md",
  );
  expect(selected.files.get("test/promptfoo-test.yaml")).toContain(
    "file://prompts/agent-instructions.md",
  );

  const ordinary = buildProject("forge-app", "sample", "tester");
  const excluded = buildProject(
    "forge-app",
    "sample",
    "tester",
    "",
    "",
    [],
    ["evals"],
    "all",
  );
  expect(excluded).toEqual(ordinary);
  expect(ordinary.packageJson.scripts.eval).toBeUndefined();
  expect(ordinary.packageJson.scripts.view).toBeUndefined();
  expect(ordinary.packageJson.devDependencies.promptfoo).toBeUndefined();
  for (const path of suitePaths) expect(ordinary.files.has(path)).toBe(false);
});

test("opt-in sync seeds missing assets, preserves existing suite, and converges", () => {
  const current = new Map<string, string>([
    [
      "package.json",
      JSON.stringify({ name: "sample", scripts: { deploy: "echo deploy" } }),
    ],
    ["promptfooconfig.yaml", "# My evaluation configuration\n"],
    ["test/data/page-1.md", "My own context\n"],
  ]);
  const plan = planSync(current, "forge-app", "tester", undefined, ["evals"]);
  expect(
    plan.operations.filter(
      ({ key }) => key === "scripts.eval" || key === "scripts.view",
    ),
  ).toHaveLength(2);
  expect(
    plan.operations.find(({ key }) => key === "devDependencies.promptfoo"),
  ).toBeDefined();
  expect(
    plan.operations.some(
      ({ path }) =>
        path === "promptfooconfig.yaml" || path === "test/data/page-1.md",
    ),
  ).toBe(false);
  expect(
    plan.operations.find(({ path }) => path === "test/promptfoo-test.yaml")
      ?.mode,
  ).toBe("create-if-absent");
  const result = applySync(plan).files;
  expect(result.get("promptfooconfig.yaml")).toBe(
    "# My evaluation configuration\n",
  );
  expect(result.get("test/data/page-1.md")).toBe("My own context\n");
  expect(result.get("test/promptfoo-test.yaml")).toBeTruthy();
  expect(
    planSync(result, "forge-app", "tester", undefined, ["evals"]).operations,
  ).toEqual([]);
  expect(planSync(result, "forge-app", "tester").operations).toEqual([]);
});

test("all preset and explicit evals produce equivalent sync plans; conflicting owned keys fail", () => {
  const current = new Map([
    ["package.json", JSON.stringify({ name: "sample" })],
  ]);
  const selected = planSync(current, "forge-app", "tester", undefined, [
    "evals",
  ]);
  const all = planSync(
    current,
    "forge-app",
    "tester",
    undefined,
    [],
    [],
    "all",
  );
  expect(all.operations).toEqual(selected.operations);
  expect(
    planSync(
      current,
      "forge-app",
      "tester",
      undefined,
      [],
      ["evals"],
      "all",
    ).operations.some(({ key }) => key === "scripts.eval" || key === "evals"),
  ).toBe(false);
  const conflict = new Map([
    [
      "package.json",
      JSON.stringify({ name: "sample", scripts: { eval: "custom eval" } }),
    ],
  ]);
  expect(() =>
    planSync(conflict, "forge-app", "tester", undefined, ["evals"]),
  ).toThrow(ConflictError);
  expect(() =>
    planSync(conflict, "forge-app", "tester", undefined, ["evals"]),
  ).toThrow(/scripts\.eval/);
  expect(() =>
    planSync(current, "forge-app", "tester", undefined, [], ["test"]),
  ).toThrow(/test/);
});

test("Dagger preview and sync accept eval selection without replacing an existing suite", async () => {
  const existing = new Map<string, string>([
    ["package.json", '{"name":"sample"}'],
    ["promptfooconfig.yaml", "# custom suite\n"],
  ]);
  const writes = new Map<string, string>();
  const directory = {
    exists: async (path: string) => existing.has(path),
    file: (path: string) => ({ contents: async () => existing.get(path) }),
    withNewFile: (path: string, contents: string) => {
      writes.set(path, contents);
      return directory;
    },
    withFile: (path: string, file: { text: string }) => {
      writes.set(path, file.text);
      return directory;
    },
  } as unknown as Directory;
  const calf = new DropCalf();
  const operations = JSON.parse(
    await calf.previewSync(directory, "forge-app", "tester", undefined, [
      "evals",
    ]),
  );
  expect(
    operations.some(({ key }: { key: string }) => key === "scripts.eval"),
  ).toBe(true);
  expect(
    operations.some(
      ({ path }: { path: string }) => path === "promptfooconfig.yaml",
    ),
  ).toBe(false);
  await calf.sync(directory, "forge-app", "tester", undefined, ["evals"]);
  expect(writes.get("test/promptfoo-test.yaml")).toBeTruthy();
  expect(writes.has("promptfooconfig.yaml")).toBe(false);
  expect(existing.get("promptfooconfig.yaml")).toBe("# custom suite\n");
});
