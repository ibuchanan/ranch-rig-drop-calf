import { expect, test } from "bun:test";
import YAML from "yaml";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, ParseError, planSync } from "../src/sync.ts";
import { gitHooksTemplates } from "./templates-source.ts";

const hooks = () => gitHooksTemplates();
const config = () => hooks().get("lefthook.yml") ?? "";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s installs Lefthook and points its scripts at the shared config",
  (kind) => {
    const { scripts, devDependencies } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    expect(devDependencies.lefthook).toBe("^2.1");
    expect(scripts.prepare).toBe("lefthook install || true");
    expect(scripts.lint).toBe("lefthook run lint");
    expect(scripts.check).toBe("lefthook run pre-push --force");
    const yml = config();
    expect(yml).toContain("lint:");
    expect(yml).toContain("npm run lint:check");
    expect(yml).toContain("gitleaks:");
    expect(yml).toContain("command -v gitleaks");
    expect(yml).toContain("stage_fixed: true");
    expect(yml).toContain("npm run format:check");
    expect(yml).toContain("npm run test --if-present");
    expect(yml).toContain("npm run size --if-present");
  },
);

test("seeds the shared hook config when the repository has none", () => {
  const plan = planSync(
    new Map([["package.json", '{"name":"sample"}']]),
    "tool",
    "tester",
    undefined,
    [],
    [],
    undefined,
    hooks(),
  );
  expect(plan.operations).toContainEqual(
    expect.objectContaining({
      path: "lefthook.yml",
      mode: "create-if-absent",
    }),
  );
  expect(applySync(plan).files.get("lefthook.yml")).toBe(config());
});

test("adopts existing hooks without replacing lint/check or unrelated YAML", () => {
  const existing = `# team policy\ncolors: true\npre-commit:\n  parallel: false\n  commands:\n    custom:\n      run: echo keep\n`;
  const files = new Map([
    [
      "package.json",
      JSON.stringify({
        name: "sample",
        scripts: { lint: "echo lint", check: "echo check" },
      }),
    ],
    ["lefthook.yml", existing],
  ]);
  const plan = planSync(
    files,
    "tool",
    "tester",
    undefined,
    [],
    [],
    undefined,
    hooks(),
  );
  expect(
    plan.operations.some(
      (op) => op.key === "scripts.lint" || op.key === "scripts.check",
    ),
  ).toBe(false);
  const result = applySync(plan).files;
  expect(result.get("lefthook.yml")).toContain("# team policy");
  expect(result.get("lefthook.yml")).toContain("run: echo keep");
  expect(YAML.parse(result.get("lefthook.yml") ?? "")).toMatchObject({
    colors: true,
    "pre-commit": {
      parallel: false,
      commands: {
        custom: { run: "echo keep" },
        format: { run: "npm run format", stage_fixed: true },
      },
    },
    "pre-push": {
      commands: {
        lint: { run: "npm run lint" },
        test: { run: "npm run test --if-present" },
        size: { run: "npm run size --if-present" },
      },
    },
  });
  expect(JSON.parse(result.get("package.json") ?? "").scripts).toMatchObject({
    lint: "echo lint",
    check: "echo check",
    prepare: "lefthook install || true",
  });
  expect(
    planSync(result, "tool", "tester", undefined, [], [], undefined, hooks())
      .operations,
  ).toEqual([]);
});

test("adoption adds missing lint and check scripts without replacing existing ones", () => {
  const files = new Map([
    ["package.json", '{"name":"sample","scripts":{}}'],
    ["lefthook.yml", "colors: true\n"],
  ]);
  const result = applySync(
    planSync(
      files,
      "agent-skill",
      "tester",
      undefined,
      [],
      [],
      undefined,
      hooks(),
    ),
  ).files;
  const scripts = JSON.parse(result.get("package.json") ?? "").scripts;
  expect(scripts.lint).toBe("lefthook run lint");
  expect(scripts.check).toBe("lefthook run pre-push --force");
  expect(
    YAML.parse(result.get("lefthook.yml") ?? "")["pre-push"].commands.test,
  ).toEqual({ run: "npm run test --if-present" });
  expect(
    planSync(
      result,
      "agent-skill",
      "tester",
      undefined,
      [],
      [],
      undefined,
      hooks(),
    ).operations,
  ).toEqual([]);
});

test("equivalent named commands are no-ops despite YAML style differences", () => {
  const project = buildProject("tool", "sample", "tester");
  const parsed = YAML.parse(config());
  const existing = `# owned by team\n${YAML.stringify(parsed)}`;
  const files = new Map([
    ["package.json", JSON.stringify(project.packageJson)],
    ["lefthook.yml", existing],
  ]);
  expect(
    planSync(
      files,
      "tool",
      "tester",
      undefined,
      [],
      [],
      undefined,
      hooks(),
    ).operations.filter((op) => op.path === "lefthook.yml"),
  ).toEqual([]);
});

test("conflicts on changed named command or unsupported hook structure", () => {
  for (const existing of [
    "pre-commit:\n  commands:\n    format:\n      run: echo replaced\n",
    "pre-commit:\n  scripts:\n    lint: npm run lint\n",
    "pre-push:\n  commands: []\n",
    "pre-commit:\n  commands:\n    custom: echo not-a-command-map\n",
  ]) {
    expect(() =>
      planSync(
        new Map([
          ["package.json", '{"name":"sample"}'],
          ["lefthook.yml", existing],
        ]),
        "tool",
        "tester",
        undefined,
        [],
        [],
        undefined,
        hooks(),
      ),
    ).toThrow(ConflictError);
  }
  expect(() =>
    planSync(
      new Map([
        ["package.json", '{"name":"sample"}'],
        ["lefthook.yml", "pre-commit: ["],
      ]),
      "tool",
      "tester",
      undefined,
      [],
      [],
      undefined,
      hooks(),
    ),
  ).toThrow(ParseError);
});
