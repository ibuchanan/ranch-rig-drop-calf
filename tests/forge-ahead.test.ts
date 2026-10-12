import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { forgeAhead } from "../src/capabilities.ts";
import { noOpReasons, validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { createBlueprint } from "../src/project.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { runInit, runUpdate } from "./capability-fixtures.ts";

const apiTypes = "@forge-ahead/atlassian-api-types";
const authoritative = {
  "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
  "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
};
const update = (directory: Directory) => runUpdate(forgeAhead(), directory);

test("Forge Ahead init seeds only API types without replacing other dependencies", () => {
  const project = createBlueprint("sample", "", "tester");
  const dependencies = { "@forge/api": "^7", "@forge-ahead/errors": "owner" };
  project.packageJson.dependencies = { ...dependencies };
  const capability = forgeAhead();
  expect(typeof capability.init).not.toBe("function");
  runInit(capability, project);
  expect(project.packageJson.dependencies).toEqual({
    ...dependencies,
    ...authoritative,
    [apiTypes]: TOOL_VERSIONS.forgeAheadApiTypes,
  });
  expect(project.packageJson.devDependencies).toEqual({});
  expect(project.files.size).toBe(0);
  expect(project.templates.map((template) => template.path)).toEqual([]);
});

test.each([undefined, "^99", "github:example/api-types#revision"])(
  "Forge Ahead update enforces errors/logging and preserves API types: %j",
  async (apiReference) => {
    const pkg = {
      name: "owner",
      dependencies: {
        "@forge/api": "^7",
        "@forge/resolver": "^1",
        "@forge-ahead/errors": "^99",
        "@forge-ahead/logging": "github:example/logging#revision",
        ...(apiReference === undefined ? {} : { [apiTypes]: apiReference }),
      },
      devDependencies: { tool: "1" },
      scripts: { build: "owner build" },
      custom: { keep: true },
    };
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        ["src/index.ts", "owner source"],
        ["package-lock.json", "owner lock"],
        ["bun.lock", "owner lock"],
      ]),
    );
    const before = [...input.files];
    const output = await update(input);
    expect(await output.file("package.json").contents()).toBe(
      sortPackageJson(
        `${JSON.stringify({ ...pkg, dependencies: { ...pkg.dependencies, ...authoritative } }, null, 2)}\n`,
      ),
    );
    for (const [path, text] of input.files)
      if (path !== "package.json")
        expect(await output.file(path).contents()).toBe(text);
    expect([...input.files]).toEqual(before);
    expect(await update(output)).toBe(output);
  },
);

test("Forge Ahead update restores owned keys, not API types or a missing package", async () => {
  const missing = mockDirectory();
  expect(await update(missing)).toBe(missing);
  for (const pkg of [
    {},
    { dependencies: {} },
    { dependencies: { keep: "1" } },
    { dependencies: { "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors } },
  ]) {
    const output = await update(
      mockDirectory(new Map([["package.json", JSON.stringify(pkg)]])),
    );
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      ...pkg,
      dependencies: { ...pkg.dependencies, ...authoritative },
    });
    expect(await update(output)).toBe(output);
  }
});

test("Forge Ahead update retains matching package bytes", async () => {
  const text = `${JSON.stringify({ custom: true, dependencies: authoritative }, null, 4)}\r\n`;
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
  '{"dependencies":null}',
  '{"dependencies":[]}',
  '{"dependencies":"bad"}',
  '{"dependencies":1}',
  '{"dependencies":true}',
])(
  "Forge Ahead update rejects unsafe package input before writes: %s",
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

test("Forge Ahead validation is an explicit no-op without reading or installing", async () => {
  const capability = forgeAhead();
  expect(typeof capability.validate).not.toBe("function");
  const reason = noOpReasons([capability]).find(
    (entry) => entry.verb === "validate",
  );
  if (!reason) throw new Error("Forge Ahead validation reason is missing");
  expect(reason).toMatchObject({
    capability: "forge-ahead",
    verb: "validate",
    reason: expect.stringContaining("no repository-local configuration"),
  });
  const input = new Proxy({} as Directory, {
    get() {
      throw new Error("unexpected repository access");
    },
  });
  expect(await validateCapabilities(input, [capability])).toEqual([
    { capability: "forge-ahead", status: "skipped", reason: reason.reason },
  ]);
});

test.each([false, true])(
  "Forge app init includes all three dependencies; update preserves API edits/deletion (scaffold: %j)",
  async (scaffold) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const dependencies = scaffold ? { "@forge/api": "^7", other: "^2" } : {};
      const input = mockDirectory(
        new Map(
          scaffold ? [["package.json", JSON.stringify({ dependencies })]] : [],
        ),
      );
      const module = new DropCalf();
      const initialized = await module.init(
        input,
        "forge-app",
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.dependencies).toEqual({
        ...dependencies,
        [apiTypes]: TOOL_VERSIONS.forgeAheadApiTypes,
        ...authoritative,
      });
      expect(await module.update(initialized, "forge-app")).toBe(initialized);
      for (const apiReference of [undefined, "^99"]) {
        const editedDependencies = { ...pkg.dependencies, ...authoritative };
        if (apiReference === undefined) delete editedDependencies[apiTypes];
        else editedDependencies[apiTypes] = apiReference;
        const edited = initialized.withNewFile(
          "package.json",
          JSON.stringify({
            ...pkg,
            dependencies: {
              ...editedDependencies,
              "@forge-ahead/errors": "^99",
              "@forge-ahead/logging": "^99",
            },
          }),
        );
        const updated = await module.update(edited, "forge-app");
        expect(
          JSON.parse(await updated.file("package.json").contents())
            .dependencies,
        ).toEqual(editedDependencies);
        expect(await module.update(updated, "forge-app")).toBe(updated);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
