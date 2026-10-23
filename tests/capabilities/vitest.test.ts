import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  VITEST_SCRIPTS,
  vitestTesting,
} from "../../src/capabilities/vitest.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runUpdate, verb } from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

test("update preserves owner configuration, test sources, and lockfiles", async () => {
  const config =
    "// owner config\nexport default { test: { globals: true, coverage: { provider: 'istanbul' } } };\n";
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          scripts: { "test:unit": "custom" },
          devDependencies: { owner: "1" },
        }),
      ],
      ["vitest.config.ts", config],
      ["tsconfig.json", "owner base"],
      ["bun.lock", "owner lock"],
      ["tests/owner.test.ts", "// owner test\n"],
    ]),
  );
  const output = await runUpdate(vitestTesting(), input);
  expect(await output.file("vitest.config.ts").contents()).toBe(config);
  expect(await output.file("tsconfig.json").contents()).toBe("owner base");
  expect(await output.file("bun.lock").contents()).toBe("owner lock");
  expect(await output.file("tests/owner.test.ts").contents()).toBe(
    "// owner test\n",
  );
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg.scripts).toEqual({ ...VITEST_SCRIPTS, "test:unit": "custom" });
});

test("update never creates a missing Vitest config", async () => {
  const input = mockDirectory(new Map([["package.json", "{}"]]));
  const output = await runUpdate(vitestTesting(), input);
  expect(await output.exists("vitest.config.ts")).toBe(false);
});

test("composed Forge update respects owner deletion of Vitest and manages TypeScript config", async () => {
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
    const pkg = JSON.parse(await initialized.file("package.json").contents());
    expect(pkg.devDependencies).toMatchObject({
      vitest: TOOL_VERSIONS.vitest,
      "@vitest/coverage-v8": TOOL_VERSIONS.vitest,
    });
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
