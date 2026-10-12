import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import ts from "typescript";
import { validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { PROFILES } from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import {
  reconcileTypeScriptConfig,
  TYPESCRIPT_CONFIGS,
  TYPESCRIPT_SCRIPTS,
  typeScriptToolchain,
  updateTypeScript,
  validateTypeScript,
} from "../src/typescript.ts";
import { NODE_MAJOR, TOOL_VERSIONS } from "../src/versions.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { typescriptTemplates, vitestTemplates } from "./templates-source.ts";

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
      const output = await updateTypeScript(input);
      const base = parsed(await output.file("tsconfig.json").contents());
      const check = parsed(
        await output.file("tsconfig.typecheck.json").contents(),
      );
      const modern = "vitest" in dependencies || "tsdown" in dependencies;
      expect(base.compilerOptions.moduleResolution).toBe(
        "tsdown" in dependencies ? "Bundler" : "Node",
      );
      expect(check.compilerOptions.moduleResolution).toBe(
        modern ? "Bundler" : "Node",
      );
      expect(check.compilerOptions.rootDir).toBe(modern ? "." : "src");
      expect(check.include).toEqual([
        "src",
        ...("vitest" in dependencies
          ? ["test", "tests", "vitest.config.ts"]
          : []),
        ...("tsdown" in dependencies ? ["tsdown.config.ts"] : []),
      ]);
      expect(await updateTypeScript(output)).toBe(output);
      expect(await input.file("tsconfig.json").contents()).toBe(
        baseline("tsconfig.json"),
      );
    } finally {
      source.mockRestore();
    }
  });
}

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init config bytes and subsequent update are stable",
  async (kind) => {
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
      expect(
        JSON.stringify(
          Object.fromEntries(
            await Promise.all(
              TYPESCRIPT_CONFIGS.map(async (path) => [
                path,
                await output.file(path).contents(),
              ]),
            ),
          ),
          null,
          2,
        ),
      ).toMatchSnapshot(kind);
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
      if (typeof capability.init === "function") capability.init(project);
      const paths = [
        ...(project.packageJson.devDependencies.typescript
          ? ["typescript"]
          : []),
        ...Object.keys(project.packageJson.scripts).filter(
          (key) => key === "build" || key === "typecheck",
        ),
        ...project.templates.flatMap((tree) =>
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
  expect(baseline("tsconfig.json")).toContain(`Node ${NODE_MAJOR}`);
  expect(baseline("tsconfig.json")).not.toContain("Node 18");
});

test("owner comments, unrelated settings and package fields survive; trigger removal resets policy", async () => {
  const source = mockModuleSource();
  try {
    const owner =
      '{\r\n // keep owner comment\r\n "compilerOptions": {"strict": false, "paths": {"@/*": ["src/*"]}, "declaration": true},\r\n "references": [{"path": "./child"}],\r\n}\r\n';
    const pkg = {
      scripts: { build: "tsdown custom", typecheck: "old", custom: "kept" },
      devDependencies: {
        typescript: "old",
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
    const output = await updateTypeScript(input);
    for (const path of TYPESCRIPT_CONFIGS) {
      const text = await output.file(path).contents();
      expect(text).toContain("// keep owner comment");
      expect(text).toContain("\r\n");
      expect(parsed(text).compilerOptions.paths).toEqual({ "@/*": ["src/*"] });
      expect(parsed(text).compilerOptions.declaration).toBe(true);
      expect(parsed(text).references).toEqual([{ path: "./child" }]);
    }
    const updated = JSON.parse(await output.file("package.json").contents());
    expect(updated).toEqual({
      ...pkg,
      scripts: { ...pkg.scripts, typecheck: TYPESCRIPT_SCRIPTS.typecheck },
      devDependencies: {
        ...pkg.devDependencies,
        typescript: TOOL_VERSIONS.typescript,
      },
    });
    expect(await updateTypeScript(output)).toBe(output);
    delete updated.devDependencies.vitest;
    delete updated.devDependencies.tsdown;
    const removed = await updateTypeScript(
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
      module: "CommonJS",
      moduleResolution: "Node",
      rootDir: "src",
    });
    expect(check.include).toEqual(["src"]);
    expect(
      JSON.parse(await removed.file("package.json").contents()).scripts.build,
    ).toBe(TYPESCRIPT_SCRIPTS.build);
    expect(await updateTypeScript(removed)).toBe(removed);
    const library = await updateTypeScript(
      input.withNewFile(
        "package.json",
        '{"scripts":{"build":"owner library"}}',
      ),
      undefined,
      false,
    );
    expect(
      JSON.parse(await library.file("package.json").contents()).scripts.build,
    ).toBe("owner library");
  } finally {
    source.mockRestore();
  }
});

test("only development declarations trigger policy and a custom compiler pin is enforced", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({ dependencies: { vitest: "5", tsdown: "0.15" } }),
        ],
      ]),
    );
    const output = await updateTypeScript(input, "5.9.3");
    expect(
      parsed(await output.file("tsconfig.json").contents()).compilerOptions
        .moduleResolution,
    ).toBe("Node");
    expect(
      parsed(await output.file("tsconfig.typecheck.json").contents()).include,
    ).toEqual(["src"]);
    expect(
      JSON.parse(await output.file("package.json").contents()).devDependencies
        .typescript,
    ).toBe("5.9.3");
    expect(await updateTypeScript(output, "5.9.3")).toBe(output);
  } finally {
    source.mockRestore();
  }
});

test("missing configs are recreated; missing package is not; matching package bytes are retained", async () => {
  const source = mockModuleSource();
  try {
    const output = await updateTypeScript(mockDirectory());
    for (const path of TYPESCRIPT_CONFIGS)
      expect(await output.exists(path)).toBe(true);
    expect(await output.exists("package.json")).toBe(false);
    expect(await updateTypeScript(output)).toBe(output);
    const pkg = JSON.stringify({
      devDependencies: { typescript: TOOL_VERSIONS.typescript },
      scripts: TYPESCRIPT_SCRIPTS,
    });
    const matching = await updateTypeScript(
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

test.each([
  "{",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"devDependencies":null}',
  '{"devDependencies":"bad"}',
])("unsafe package fails before writes: %s", async (contents) => {
  const input = mockDirectory(new Map([["package.json", contents]]));
  await expect(updateTypeScript(input)).rejects.toThrow("package.json");
  expect(input.files.size).toBe(1);
});

test("validation uses the selected compiler and two read-only showConfig commands without enforcing policy", async () => {
  const { spy, commands, mounts } = mockContainer();
  const input = mockDirectory(
    new Map(
      TYPESCRIPT_CONFIGS.map((path) => [
        path,
        '{"compilerOptions":{"strict":false}}',
      ]),
    ),
  );
  try {
    const capability = typeScriptToolchain("5.9.3");
    expect((await validateCapabilities(input, [capability]))[0]?.status).toBe(
      "validated",
    );
    expect(commands).toContainEqual([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      "typescript@5.9.3",
    ]);
    for (const path of TYPESCRIPT_CONFIGS)
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
  expect((await validateTypeScript(mockDirectory())).status).toBe("skipped");
  expect(
    (
      await validateTypeScript(
        mockDirectory(new Map([["tsconfig.json", "{}"]])),
      )
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
