import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import ts from "typescript";
import {
  reconcileTypeScriptConfig,
  TYPESCRIPT_CONFIGS,
  TYPESCRIPT_SCRIPTS,
  typeScriptToolchain,
} from "../../src/capabilities/typescript.ts";
import { PROFILES } from "../../src/composition/profiles.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit, runUpdate, verb } from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import {
  typescriptTemplates,
  vitestTemplates,
} from "../support/templates-source.ts";

const parsed = (contents: string) =>
  ts.parseConfigFileTextToJson("config.json", contents).config;
const configs = typescriptTemplates();
const baseline = (path: string) => configs.get(path) ?? "";

for (const dependencies of [
  {},
  { vitest: "5" },
  { tsdown: "0.15" },
  { vitest: "5", tsdown: "0.15" },
]) {
  test(`dependency-driven compiler settings: ${JSON.stringify(dependencies)}`, async () => {
    const source = mockModuleSource();
    try {
      const input = mockDirectory(
        new Map([
          ...configs,
          ["package.json", JSON.stringify({ devDependencies: dependencies })],
        ]),
      );
      const output = await runUpdate(typeScriptToolchain(), input);
      const base = parsed(await output.file("tsconfig.json").contents());
      const check = parsed(
        await output.file("tsconfig.typecheck.json").contents(),
      );
      const modern = "vitest" in dependencies || "tsdown" in dependencies;
      expect(base.compilerOptions.module).toBe("ESNext");
      expect(base.compilerOptions.moduleResolution).toBe(
        "tsdown" in dependencies ? "Bundler" : "Node",
      );
      expect(check.compilerOptions.module).toBe("ESNext");
      expect(check.compilerOptions.moduleResolution).toBe(
        modern ? "Bundler" : "Node",
      );
      expect(base.compilerOptions.types).toEqual(["node"]);
      expect(check.compilerOptions.rootDir).toBe(".");
      expect(check.compilerOptions.types).toEqual(["node"]);
      expect(check.include).toEqual([
        "src",
        "test",
        "tests",
        ...("vitest" in dependencies ? ["vitest.config.ts"] : []),
      ]);
      expect(await runUpdate(typeScriptToolchain(), output)).toBe(output);
      expect(await input.file("tsconfig.json").contents()).toBe(
        baseline("tsconfig.json"),
      );
    } finally {
      source.mockRestore();
    }
  });
}

/** Per kind: the module system its compiler configs must agree on, and whether the typecheck overlay also covers tests. */
const initPolicy = {
  library: { bundler: true, tests: false, declarations: true },
  "forge-app": { bundler: false, tests: true, declarations: false },
  tool: { bundler: true, tests: false, declarations: false },
  "agent-skill": { bundler: false, tests: false, declarations: false },
} as const;

test.each(Object.entries(initPolicy))(
  "%s init emits the configs its policy requires and a subsequent update is stable",
  async (kind, policy) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const output = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      for (const path of TYPESCRIPT_CONFIGS)
        expect(await output.exists(path)).toBe(
          path !== "tsconfig.declarations.json" || policy.declarations,
        );
      const base = parsed(await output.file("tsconfig.json").contents());
      const check = parsed(
        await output.file("tsconfig.typecheck.json").contents(),
      );
      expect(base.compilerOptions).toMatchObject({
        strict: true,
        sourceMap: true,
        module: "ESNext",
        types: kind === "tool" ? ["bun"] : ["node"],
        moduleResolution: policy.bundler ? "Bundler" : "Node",
      });
      expect(check.compilerOptions.types).toEqual(
        kind === "tool" ? ["bun"] : policy.tests ? ["node"] : ["node", "bun"],
      );
      expect(check.extends).toBe("./tsconfig.json");
      expect(check.compilerOptions.noEmit).toBe(true);
      expect(check.include).toEqual([
        "src",
        "test",
        "tests",
        ...(policy.tests ? ["vitest.config.ts"] : []),
      ]);
      expect(await module.update(output, kind)).toBe(output);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("every TypeScript output has exactly one init contributor per profile", () => {
  for (const capabilities of Object.values(PROFILES)) {
    const owners = new Map<string, string[]>();
    for (const capability of capabilities) {
      const project = createBlueprint("sample", "", "tester");
      runInit(capability, project);
      const paths = [
        ...(project.packageJson.devDependencies.typescript
          ? ["typescript"]
          : []),
        ...Object.keys(project.packageJson.scripts).filter(
          (key) => key === "build" || key === "typecheck",
        ),
        ...project.templates.flatMap(({ path: tree }) =>
          tree === "templates/typescript"
            ? [...configs.keys()]
            : tree === "templates/vitest"
              ? [...vitestTemplates().keys()]
              : [],
        ),
      ];
      for (const path of paths)
        owners.set(path, [...(owners.get(path) ?? []), capability.name]);
    }
    for (const path of [
      "typescript",
      "build",
      "typecheck",
      ...TYPESCRIPT_CONFIGS,
    ])
      expect(owners.get(path), path).toHaveLength(1);
  }
  expect(baseline("tsconfig.json")).toContain("Node selected by .nvmrc");
  expect(baseline("tsconfig.json")).not.toContain("Node 18");
});

test("owner comments, unrelated settings and package fields survive; trigger removal resets policy", async () => {
  const source = mockModuleSource();
  try {
    const owner =
      '{\r\n // keep owner comment\r\n "compilerOptions": {"strict": false, "types": ["jest"], "paths": {"@/*": ["src/*"]}, "declaration": true},\r\n "references": [{"path": "./child"}],\r\n}\r\n';
    const pkg = {
      scripts: { build: "tsdown custom", typecheck: "old", custom: "kept" },
      devDependencies: {
        typescript: "0.0.1",
        vitest: "5",
        tsdown: "0.15",
        kept: "1",
      },
      custom: true,
    };
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        ...TYPESCRIPT_CONFIGS.map((path): [string, string] => [path, owner]),
      ]),
    );
    const output = await runUpdate(
      typeScriptToolchain({ ownsBuild: false }),
      input,
    );
    for (const path of TYPESCRIPT_CONFIGS) {
      const text = await output.file(path).contents();
      expect(text).toContain("// keep owner comment");
      expect(text).toContain("\r\n");
      expect(parsed(text).compilerOptions.paths).toEqual({ "@/*": ["src/*"] });
      expect(parsed(text).compilerOptions.types).toEqual(
        path === "tsconfig.declarations.json" ? ["jest"] : ["node"],
      );
      expect(parsed(text).compilerOptions.declaration).toBe(true);
      expect(parsed(text).references).toEqual([{ path: "./child" }]);
    }
    const updated = JSON.parse(await output.file("package.json").contents());
    expect(updated).toEqual({
      ...pkg,
      scripts: {
        ...pkg.scripts,
        typecheck: TYPESCRIPT_SCRIPTS.typecheck,
        "lint:check:typecheck": TYPESCRIPT_SCRIPTS["lint:check:typecheck"],
      },
      devDependencies: {
        ...pkg.devDependencies,
        typescript: TOOL_VERSIONS.typescript,
      },
    });
    expect(
      await runUpdate(typeScriptToolchain({ ownsBuild: false }), output),
    ).toBe(output);
    delete updated.devDependencies.vitest;
    delete updated.devDependencies.tsdown;
    const removed = await runUpdate(
      typeScriptToolchain(),
      output.withNewFile("package.json", JSON.stringify(updated)),
    );
    expect(
      parsed(await removed.file("tsconfig.json").contents()).compilerOptions
        .moduleResolution,
    ).toBe("Node");
    const check = parsed(
      await removed.file("tsconfig.typecheck.json").contents(),
    );
    expect(check.compilerOptions).toMatchObject({
      module: "ESNext",
      moduleResolution: "Node",
      rootDir: ".",
    });
    expect(check.include).toEqual(["src", "test", "tests"]);
    expect(
      JSON.parse(await removed.file("package.json").contents()).scripts.build,
    ).toBe(TYPESCRIPT_SCRIPTS.build);
    expect(await runUpdate(typeScriptToolchain(), removed)).toBe(removed);
    const library = await runUpdate(
      typeScriptToolchain({ ownsBuild: false }),
      input.withNewFile(
        "package.json",
        '{"scripts":{"build":"owner library"}}',
      ),
    );
    expect(
      JSON.parse(await library.file("package.json").contents()).scripts.build,
    ).toBe("owner library");
  } finally {
    source.mockRestore();
  }
});

test("default compiler pin is enforced", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            devDependencies: { typescript: "0.0.1" },
            dependencies: { vitest: "5", tsdown: "0.15" },
          }),
        ],
      ]),
    );
    const output = await runUpdate(typeScriptToolchain(), input);
    expect(
      parsed(await output.file("tsconfig.json").contents()).compilerOptions
        .moduleResolution,
    ).toBe("Node");
    expect(
      parsed(await output.file("tsconfig.typecheck.json").contents()).include,
    ).toEqual(["src", "test", "tests"]);
    expect(
      JSON.parse(await output.file("package.json").contents()).devDependencies
        .typescript,
    ).toBe(TOOL_VERSIONS.typescript);
    expect(await runUpdate(typeScriptToolchain(), output)).toBe(output);
  } finally {
    source.mockRestore();
  }
});

test("missing configs are recreated; missing package is not; matching package bytes are retained", async () => {
  const source = mockModuleSource();
  try {
    const output = await runUpdate(typeScriptToolchain(), mockDirectory());
    // declarations config only created when tsdown is present
    expect(await output.exists("tsconfig.json")).toBe(true);
    expect(await output.exists("tsconfig.typecheck.json")).toBe(true);
    expect(await output.exists("tsconfig.declarations.json")).toBe(false);
    expect(await output.exists("package.json")).toBe(false);
    expect(await runUpdate(typeScriptToolchain(), output)).toBe(output);
    const pkg = JSON.stringify({
      devDependencies: { typescript: TOOL_VERSIONS.typescript },
      scripts: TYPESCRIPT_SCRIPTS,
    });
    const matching = await runUpdate(
      typeScriptToolchain(),
      output.withNewFile("package.json", pkg),
    );
    expect(await matching.file("package.json").contents()).toBe(pkg);
  } finally {
    source.mockRestore();
  }
});

test.each([
  "{",
  "[]",
  "null",
  '{"compilerOptions":null}',
  '{"compilerOptions":[]}',
  '{"compilerOptions":{},"compilerOptions":{}}',
])("unsafe config fails before edits: %s", (contents) => {
  expect(() =>
    reconcileTypeScriptConfig(
      "tsconfig.json",
      contents,
      baseline("tsconfig.json"),
      {},
    ),
  ).toThrow("tsconfig.json");
});

test("validation uses the default compiler and two read-only showConfig commands without enforcing policy", async () => {
  const { spy, commands, mounts } = mockContainer();
  // Only the two baseline configs are supplied.
  const input = mockDirectory(
    new Map(
      ["tsconfig.json", "tsconfig.typecheck.json"].map((path) => [
        path,
        '{"compilerOptions":{"strict":false}}',
      ]),
    ),
  );
  try {
    const capability = typeScriptToolchain();
    expect((await validateCapabilities(input, [capability]))[0]?.status).toBe(
      "validated",
    );
    expect(commands).toContainEqual([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `typescript@${TOOL_VERSIONS.typescript}`,
    ]);
    // No declaration config exists to validate.
    for (const path of ["tsconfig.json", "tsconfig.typecheck.json"])
      expect(commands).toContainEqual([
        "tsc",
        "--showConfig",
        "--project",
        path,
      ]);
    expect(mounts).toEqual([{ path: "/repo", readOnly: true }]);
    expect(input.files.size).toBe(2);
  } finally {
    spy.mockRestore();
  }
});

test("validation skips both missing configs, fails a partial pair, and retains compiler stdout diagnostics", async () => {
  expect(
    (await verb(typeScriptToolchain(), "validate")(mockDirectory())).status,
  ).toBe("skipped");
  expect(
    (
      await verb(
        typeScriptToolchain(),
        "validate",
      )(mockDirectory(new Map([["tsconfig.json", "{}"]])))
    ).status,
  ).toBe("failed");
  const { spy } = mockContainer({
    failure: Object.assign(new Error("exec failed"), {
      stdout: "error TS18003: No inputs were found",
      stderr: "",
    }),
  });
  try {
    const report = await validateCapabilities(mockDirectory(configs), [
      typeScriptToolchain(),
    ]);
    expect(report[0]?.status).toBe("failed");
    expect(
      report[0] && "reason" in report[0] ? report[0].reason : "",
    ).toContain("TS18003");
  } finally {
    spy.mockRestore();
  }
});
