import { expect, test } from "bun:test";
import { DropCalf } from "../src/index.ts";
import { applySync, planSync } from "../src/sync.ts";
import { mockModuleSource } from "./module-source.ts";
import { typescriptTemplates } from "./templates-source.ts";

const packageFile = '{"name":"sample"}';

/** `forge-app` seeds its configs from `templates/typescript`, so sync needs them. */
const forgePlan = (files: Map<string, string>) =>
  planSync(
    files,
    "forge-app",
    "tester",
    undefined,
    [],
    [],
    undefined,
    typescriptTemplates(),
  );

test("forge sync seeds both TypeScript configs verbatim when absent", () => {
  const templates = typescriptTemplates();
  const base = templates.get("tsconfig.json");
  const check = templates.get("tsconfig.typecheck.json");
  if (base === undefined || check === undefined)
    throw new Error("templates/typescript is missing a config");
  const plan = forgePlan(new Map([["package.json", packageFile]]));
  expect(plan.operations).toContainEqual({
    path: "tsconfig.json",
    key: "config",
    mode: "create-if-absent",
    before: undefined,
    after: base,
  });
  expect(plan.operations).toContainEqual({
    path: "tsconfig.typecheck.json",
    key: "config",
    mode: "create-if-absent",
    before: undefined,
    after: check,
  });
  const output = applySync(plan).files;
  for (const [path, template] of templates)
    expect(output.get(path)).toBe(template);
  expect(forgePlan(output).operations).toEqual([]);
});

test("sync never rewrites a TypeScript config the project already has", () => {
  const existing = `{
  "compilerOptions": {
    // mine
    "paths": { "@app/*": ["src/*"] }
  }
}\n`;
  const files = new Map([
    ["package.json", packageFile],
    ["tsconfig.json", existing],
  ]);
  const plan = forgePlan(files);
  // The existing config is untouched; only the absent one is seeded.
  expect(
    plan.operations
      .filter((operation) => operation.path.includes("tsconfig"))
      .map((operation) => operation.path),
  ).toEqual(["tsconfig.typecheck.json"]);
  const output = applySync(plan).files;
  expect(output.get("tsconfig.json")).toBe(existing);
  expect(output.get("tsconfig.typecheck.json")).toBe(
    typescriptTemplates().get("tsconfig.typecheck.json"),
  );
});
test("sync leaves an unparseable TypeScript config alone rather than failing", () => {
  const broken = '{"compilerOptions": {';
  const files = new Map([
    ["package.json", packageFile],
    ["tsconfig.json", broken],
  ]);
  expect(applySync(forgePlan(files)).files.get("tsconfig.json")).toBe(broken);
});

test("every kind seeds the same shared config", () => {
  const templates = typescriptTemplates();
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const result = applySync(
      planSync(
        new Map([["package.json", packageFile]]),
        kind,
        "tester",
        undefined,
        [],
        [],
        undefined,
        templates,
      ),
    ).files;
    for (const [path, template] of templates)
      expect(result.get(path)).toBe(template);
  }
});

test("library sync adds publishing fields and its build config without losing custom metadata", () => {
  const files = new Map([
    [
      "package.json",
      '{"name":"sample","private":false,"description":"custom"}',
    ],
  ]);
  const result = applySync(planSync(files, "library", "tester")).files;
  const pkg = JSON.parse(result.get("package.json") ?? "null");
  expect(pkg).toMatchObject({
    private: false,
    description: "custom",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    exports: {
      ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
    },
  });
  expect(result.get("tsdown.config.ts")).toContain('entry: ["src/index.ts"]');
  expect(planSync(result, "library", "tester").operations).toEqual([]);
});

test("library sync surfaces conflicting publishing fields or tsdown config", () => {
  expect(() =>
    planSync(
      new Map([["package.json", '{"name":"sample","main":"./other.js"}']]),
      "library",
      "tester",
    ),
  ).toThrow(/package.json.*main/);
  expect(() =>
    planSync(
      new Map([
        ["package.json", packageFile],
        ["tsdown.config.ts", "// custom tsdown config\n"],
      ]),
      "library",
      "tester",
    ),
  ).toThrow(/tsdown.config.ts/);
});

test("Dagger sync leaves an existing TypeScript config untouched", async () => {
  const existing = '{ "compilerOptions": { "moduleResolution": "Bundler" } }';
  const writes: string[] = [];
  const source = {
    exists: async (path: string) =>
      path === "package.json" || path === "tsconfig.json",
    file: (path: string) => ({
      contents: async () => (path === "package.json" ? packageFile : existing),
    }),
    withNewFile: (path: string) => {
      writes.push(path);
      return source;
    },
    withFile: (path: string) => {
      writes.push(path);
      return source;
    },
  } as unknown as Parameters<DropCalf["sync"]>[0];
  const module = mockModuleSource();
  try {
    await new DropCalf().sync(source, "forge-app", "tester");
    expect(writes).not.toContain("tsconfig.json");
  } finally {
    module.mockRestore();
  }
});
