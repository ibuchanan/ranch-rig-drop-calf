import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";

test("test-capable kinds expose Bun test, watch and coverage commands on an empty starter", () => {
  for (const kind of ["library", "forge-app", "tool"]) {
    const { packageJson, files } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.test).toBe("bun test --pass-with-no-tests");
    expect(packageJson.scripts["test:watch"]).toBe(
      "bun test --watch --pass-with-no-tests",
    );
    expect(packageJson.scripts["test:coverage"]).toBe(
      "bun test --coverage --pass-with-no-tests",
    );
    expect(packageJson.devDependencies.vitest).toBeUndefined();
    expect(files.has("vitest.config.ts")).toBe(false);
  }
  const agent = buildProject("agent-skill", "sample", "tester");
  expect(
    Object.keys(agent.packageJson.scripts).filter((key) =>
      key.startsWith("test"),
    ),
  ).toEqual([]);
});

test("sync adds missing Bun commands without touching existing test configuration or source", () => {
  const files = new Map([
    [
      "package.json",
      JSON.stringify({
        name: "sample",
        scripts: {
          test: "bun test --pass-with-no-tests",
          deploy: "echo deploy",
        },
      }),
    ],
    ["bunfig.toml", '[test]\npreload = ["./tests/setup.ts"]\n'],
    [
      "tests/example.test.ts",
      'import { test } from "bun:test";\ntest("ok", () => {});\n',
    ],
  ]);
  const plan = planSync(files, "tool", "tester");
  expect(
    plan.operations.filter(({ key }) => key.startsWith("scripts.test")),
  ).toEqual([
    expect.objectContaining({
      key: "scripts.test:watch",
      after: "bun test --watch --pass-with-no-tests",
    }),
    expect.objectContaining({
      key: "scripts.test:coverage",
      after: "bun test --coverage --pass-with-no-tests",
    }),
  ]);
  const result = applySync(plan).files;
  expect(result.get("bunfig.toml")).toBe(files.get("bunfig.toml"));
  expect(result.get("tests/example.test.ts")).toBe(
    files.get("tests/example.test.ts"),
  );
  expect(JSON.parse(result.get("package.json") ?? "{}").scripts.deploy).toBe(
    "echo deploy",
  );
  expect(planSync(result, "tool", "tester").operations).toEqual([]);
});

test("sync reports an incompatible owned test command before any changes", () => {
  const files = new Map([
    [
      "package.json",
      JSON.stringify({
        name: "sample",
        scripts: { "test:coverage": "vitest run --coverage" },
      }),
    ],
    ["bunfig.toml", "[test]\n"],
  ]);
  expect(() => planSync(files, "forge-app", "tester")).toThrow(ConflictError);
  expect(() => planSync(files, "forge-app", "tester")).toThrow(
    /scripts\.test:coverage/,
  );
  expect(files.get("bunfig.toml")).toBe("[test]\n");
  expect(
    JSON.parse(files.get("package.json") ?? "{}").scripts["test:coverage"],
  ).toBe("vitest run --coverage");
});
