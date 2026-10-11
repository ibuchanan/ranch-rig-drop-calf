import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";

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
