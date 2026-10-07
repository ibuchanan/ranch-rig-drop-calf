import { expect, test } from "bun:test";
import ts from "typescript";
import { DropCalf } from "../src/index.ts";
import { applySync, ConflictError, ParseError, planSync } from "../src/sync.ts";

const packageFile = '{"name":"sample"}';
const parse = (text: string | undefined) =>
  ts.parseConfigFileTextToJson("tsconfig.json", text ?? "").config;

test("sync preserves TypeScript comments and unrelated settings while adding required options", () => {
  const existing = `{
  // Keep this project-specific setting.
  "compilerOptions": {
    "paths": { "@app/*": ["src/*"] },
    "strict": true // user note
  },
  "exclude": ["generated"]
}\n`;
  const files = new Map([
    ["package.json", packageFile],
    ["tsconfig.json", existing],
  ]);
  const plan = planSync(files, "forge-app", "tester");
  expect(plan.operations).toContainEqual(
    expect.objectContaining({
      path: "tsconfig.json",
      mode: "structured-merge",
    }),
  );
  expect(plan.operations).toContainEqual(
    expect.objectContaining({
      path: "tsconfig.typecheck.json",
      mode: "create-if-absent",
    }),
  );
  const output = applySync(plan).files;
  const base = output.get("tsconfig.json") ?? "";
  expect(base).toContain("// Keep this project-specific setting.");
  expect(base).toContain("// user note");
  expect(parse(base).compilerOptions.strict).toBe(true);
  expect(parse(base)).toMatchObject({
    compilerOptions: {
      paths: { "@app/*": ["src/*"] },
      moduleResolution: "Node",
      strict: true,
    },
    exclude: ["generated"],
  });
  expect(parse(output.get("tsconfig.typecheck.json"))).toMatchObject({
    extends: "./tsconfig.json",
    compilerOptions: { noUncheckedIndexedAccess: true },
  });
  expect(planSync(output, "forge-app", "tester").operations).toEqual([]);
});

test("sync reports an owned TypeScript option conflict without changing input", () => {
  const original =
    '{ // custom\n "compilerOptions": { "moduleResolution": "Bundler" }\n}\n';
  const files = new Map([
    ["package.json", packageFile],
    ["tsconfig.json", original],
  ]);
  expect(() => planSync(files, "forge-app", "tester")).toThrow(ConflictError);
  expect(() => planSync(files, "forge-app", "tester")).toThrow(
    /tsconfig.json.*moduleResolution/,
  );
  expect(files.get("tsconfig.json")).toBe(original);
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

test("sync rejects invalid TypeScript config before any apply", () => {
  expect(() =>
    planSync(
      new Map([
        ["package.json", packageFile],
        ["tsconfig.json", '{"compilerOptions": {'],
      ]),
      "tool",
      "tester",
    ),
  ).toThrow(ParseError);
});

test("Dagger sync reads existing TypeScript config instead of overwriting it", async () => {
  const existing = '{ "compilerOptions": { "moduleResolution": "Bundler" } }';
  let writes = 0;
  const source = {
    exists: async (path: string) =>
      path === "package.json" || path === "tsconfig.json",
    file: (path: string) => ({
      contents: async () => (path === "package.json" ? packageFile : existing),
    }),
    withNewFile: () => {
      writes++;
      return source;
    },
  } as unknown as Parameters<DropCalf["sync"]>[0];
  await expect(
    new DropCalf().sync(source, "forge-app", "tester"),
  ).rejects.toThrow(/tsconfig.json.*moduleResolution/);
  expect(writes).toBe(0);
});
