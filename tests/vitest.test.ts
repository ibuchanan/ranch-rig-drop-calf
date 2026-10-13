import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { VITEST_SCRIPTS, vitestTesting } from "../src/vitest.ts";
import { runUpdate, verb } from "./capability-fixtures.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

test("update converges scripts and matching tool pins while preserving owner configuration and unrelated fields", async () => {
  const config =
    "// owner config\nexport default { test: { globals: true, coverage: { provider: 'istanbul' } } };\n";
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: {
            test: "owner",
            "test:watch": "owner",
            "test:coverage": "owner",
            "test:unit": "custom",
          },
          devDependencies: {
            vitest: "4.0.7",
            "@vitest/coverage-v8": "4.1.6",
            owner: "1",
          },
          dependencies: { keep: "1" },
        }),
      ],
      ["vitest.config.ts", config],
      ["tsconfig.json", "owner base"],
      ["tsconfig.typecheck.json", "owner check"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const output = await runUpdate(vitestTesting(), input);
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg.scripts).toEqual({ ...VITEST_SCRIPTS, "test:unit": "custom" });
  expect(pkg.devDependencies).toEqual({
    vitest: TOOL_VERSIONS.vitest,
    "@vitest/coverage-v8": TOOL_VERSIONS.vitest,
    owner: "1",
  });
  expect(pkg.dependencies).toEqual({ keep: "1" });
  expect(pkg.name).toBe("owner");
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await runUpdate(vitestTesting(), output)).toBe(output);
});

test("update never creates a missing Vitest config", async () => {
  const input = mockDirectory(new Map([["package.json", "{}"]]));
  const output = await runUpdate(vitestTesting(), input);
  expect(await output.exists("vitest.config.ts")).toBe(false);
});

test("composed Forge update preserves missing Vitest declaration and TypeScript respects owner deletion", async () => {
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const module = new DropCalf();
    const initialized = await module.init(
      mockDirectory(),
      "forge-app",
      "tester",
      "sample",
    );
    expect(await module.update(initialized, "forge-app")).toEqual(initialized);
    const pkg = JSON.parse(await initialized.file("package.json").contents());
    delete pkg.devDependencies.vitest;
    delete pkg.devDependencies["@vitest/coverage-v8"];
    const input = initialized
      .withNewFile("package.json", JSON.stringify(pkg))
      .withNewFile("tsconfig.typecheck.json", "{}");
    const output = await module.update(input, "forge-app");
    const check = JSON.parse(
      await output.file("tsconfig.typecheck.json").contents(),
    );
    expect(check.compilerOptions.moduleResolution).toBe("Node");
    expect(check.include).toEqual(["src", "test", "tests"]);
    expect(await module.update(output, "forge-app")).toEqual(output);
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("validation uses the default pin with read-only mounts and no input edits", async () => {
  const { spy, commands, mounts } = mockContainer();
  const input = mockDirectory(new Map([["vitest.config.ts", "owner config"]]));
  try {
    expect(
      (await validateCapabilities(input, [vitestTesting()]))[0]?.status,
    ).toBe("validated");
    expect(commands).toContainEqual([
      "bun",
      "add",
      "--ignore-scripts",
      `vitest@${TOOL_VERSIONS.vitest}`,
      `@vitest/coverage-v8@${TOOL_VERSIONS.vitest}`,
    ]);
    expect(commands).toContainEqual([
      "bun",
      "run",
      "--no-install",
      "/tools/validate.mjs",
    ]);
    expect(mounts.length).toBeGreaterThan(0);
    expect(mounts.every((mount) => mount.readOnly)).toBe(true);
    expect(input.files.size).toBe(1);
  } finally {
    spy.mockRestore();
  }
});

test("validation skips missing config and retains execution diagnostics", async () => {
  expect(await verb(vitestTesting(), "validate")(mockDirectory())).toEqual({
    status: "skipped",
    reason: "vitest.config.ts is missing",
  });
  const { spy } = mockContainer({
    failure: Object.assign(new Error("exec failed"), {
      stdout: "",
      stderr: "coverage provider mismatch",
    }),
  });
  try {
    const [report] = await validateCapabilities(
      mockDirectory(new Map([["vitest.config.ts", "config"]])),
      [vitestTesting()],
    );
    expect(report?.status).toBe("failed");
    expect(report && "reason" in report ? report.reason : "").toContain(
      "coverage provider mismatch",
    );
  } finally {
    spy.mockRestore();
  }
});
