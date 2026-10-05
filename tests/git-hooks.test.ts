import { expect, test } from "bun:test";
import YAML from "yaml";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, ParseError, planSync } from "../src/sync.ts";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s generates managed Lefthook scripts and named commands",
  (kind) => {
    const project = buildProject(kind, "sample", "", "none");
    const { scripts, devDependencies } = project.packageJson;
    const config = project.files.get("lefthook.yml") ?? "";
    expect(devDependencies.lefthook).toBeDefined();
    expect(scripts.prepare).toBe("lefthook install");
    expect(scripts.lint).toBe("lefthook run esa-lint");
    expect(scripts.check).toBe("lefthook run pre-push --force");
    expect(config).toContain("esa-lint:");
    expect(config).toContain("npm run typecheck");
    expect(config).toContain("esa-gitleaks:");
    expect(config).toContain("command -v gitleaks");
    expect(config).toContain("esa-format:");
    expect(config).toContain("stage_fixed: true");
    expect(config).toContain("esa-format-check:");
    if (kind === "agent-skill") {
      expect(config).not.toContain("esa-test:");
      expect(config).not.toContain("npm run test");
    } else {
      expect(config).toContain("esa-test:");
      expect(config).toContain("npm run test");
    }
  },
);

test("adopts existing hooks without replacing lint/check or unrelated YAML", () => {
  const config = `# team policy\ncolors: true\npre-commit:\n  parallel: false\n  commands:\n    custom:\n      run: echo keep\n`;
  const files = new Map([
    [
      "package.json",
      JSON.stringify({
        name: "sample",
        scripts: { lint: "echo lint", check: "echo check" },
      }),
    ],
    ["lefthook.yml", config],
  ]);
  const plan = planSync(files, "tool");
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
        "esa-format": { run: "npm run format", stage_fixed: true },
      },
    },
    "pre-push": {
      commands: { "esa-format-check": { run: "npm run format:check" } },
    },
  });
  expect(JSON.parse(result.get("package.json") ?? "").scripts).toMatchObject({
    lint: "echo lint",
    check: "echo check",
    prepare: "lefthook install",
  });
  expect(planSync(result, "tool").operations).toEqual([]);
});

test("adoption adds missing lint and check scripts without replacing existing ones", () => {
  const files = new Map([
    ["package.json", '{"name":"sample","scripts":{}}'],
    ["lefthook.yml", "colors: true\n"],
  ]);
  const result = applySync(planSync(files, "agent-skill")).files;
  const scripts = JSON.parse(result.get("package.json") ?? "").scripts;
  expect(scripts.lint).toBe("lefthook run esa-lint");
  expect(scripts.check).toBe("lefthook run pre-push --force");
  expect(
    YAML.parse(result.get("lefthook.yml") ?? "")["pre-push"].commands[
      "esa-test"
    ],
  ).toBeUndefined();
  expect(planSync(result, "agent-skill").operations).toEqual([]);
});

test("equivalent named commands are no-ops despite YAML style differences", () => {
  const project = buildProject("tool", "sample", "", "none");
  const parsed = YAML.parse(project.files.get("lefthook.yml") ?? "");
  const config = `# owned by team\n${YAML.stringify(parsed)}`;
  const files = new Map([
    ["package.json", JSON.stringify(project.packageJson)],
    ["lefthook.yml", config],
  ]);
  expect(
    planSync(files, "tool").operations.filter(
      (op) => op.path === "lefthook.yml",
    ),
  ).toEqual([]);
});

test("conflicts on changed named command or unsupported hook structure", () => {
  for (const config of [
    "pre-commit:\n  commands:\n    esa-format:\n      run: echo replaced\n",
    "pre-commit:\n  scripts:\n    lint: npm run lint\n",
    "pre-push:\n  commands: []\n",
    "pre-commit:\n  commands:\n    custom: echo not-a-command-map\n",
  ]) {
    expect(() =>
      planSync(
        new Map([
          ["package.json", '{"name":"sample"}'],
          ["lefthook.yml", config],
        ]),
        "tool",
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
    ),
  ).toThrow(ParseError);
});
