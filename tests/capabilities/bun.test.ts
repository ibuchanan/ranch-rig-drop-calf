import { expect, spyOn, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { dag } from "@dagger.io/dagger";
import ts from "typescript";
import { bunBaseline } from "../../src/capabilities/bun.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runUpdate } from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const catalog =
  "metadata:\n  annotations:\n    forge-ranch/license: Apache-2.0\n";

test("tool seeds a Bun-only baseline, binary build, and retained quality workflows", async () => {
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const module = new DropCalf();
    const output = await module.init(
      mockDirectory(),
      "tool",
      "tester",
      "@scope/example",
    );
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg.packageManager).toBe(`bun@${TOOL_VERSIONS.bun}`);
    expect(pkg.devDependencies["@types/bun"]).toBe(TOOL_VERSIONS.bun);
    expect(pkg.devDependencies["@types/node"]).toBeUndefined();
    expect(pkg.engines).toBeUndefined();
    expect(await output.exists(".nvmrc")).toBe(false);
    expect(await output.exists(".npmrc")).toBe(false);
    expect(await output.file("bunfig.toml").contents()).toContain("bun = true");
    expect(await output.file("bunfig.toml").contents()).toContain(
      "https://registry.npmjs.org/",
    );
    expect(pkg.scripts).toMatchObject({
      build: "bun build --compile ./src/index.ts --outfile ./dist/cli",
      clean: "rm -rf dist",
      test: "bun test --pass-with-no-tests",
      typecheck: "tsc --project tsconfig.typecheck.json --noEmit",
      "lint:check:typecheck": "bun run typecheck",
      "lint:check:fallow": "FALLOW_TELEMETRY=off fallow --summary",
    });
    expect(
      Object.values(pkg.scripts).some((script) =>
        /\bnpm run\b/.test(String(script)),
      ),
    ).toBe(false);
    for (const path of ["tsconfig.json", "tsconfig.typecheck.json"]) {
      const config = ts.parseConfigFileTextToJson(
        path,
        await output.file(path).contents(),
      ).config;
      expect(config.compilerOptions).toMatchObject({
        noEmit: true,
        allowImportingTsExtensions: true,
        moduleResolution: "Bundler",
        types: ["bun"],
      });
    }
    expect(resolveProfile("tool").map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "bun",
        "bun-build",
        "typescript",
        "test",
        "biome",
        "fallow",
        "clean-build",
      ]),
    );
    expect(await module.update(output, "tool")).toBe(output);
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("Bun update maintains package manager and license without altering owner runtime files", async () => {
  const pkg = {
    packageManager: "npm@10.0.0",
    license: "old",
    engines: { node: ">=22" },
    devDependencies: { "@types/node": "22" },
    scripts: { custom: "keep" },
  };
  const ownerFiles = [
    ["bunfig.toml", "[run]\nbun = false\n"],
    [".nvmrc", "22\n"],
    [".npmrc", "registry=https://example.invalid/\n"],
  ] as [string, string][];
  const input = mockDirectory(
    new Map([
      ["catalog-info.yaml", catalog],
      ["package.json", JSON.stringify(pkg)],
      ...ownerFiles,
    ]),
  );
  const output = await runUpdate(bunBaseline(), input);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    ...pkg,
    packageManager: `bun@${TOOL_VERSIONS.bun}`,
    license: "Apache-2.0",
  });
  for (const [path, contents] of ownerFiles)
    expect(await output.file(path).contents()).toBe(contents);
  expect(await runUpdate(bunBaseline(), output)).toBe(output);
  const empty = mockDirectory();
  expect(await runUpdate(bunBaseline(), empty)).toBe(empty);
  await expect(
    runUpdate(bunBaseline(), mockDirectory(new Map([["package.json", "{}"]]))),
  ).rejects.toThrow("catalog-info.yaml");
});

test("Bun validation checks TOML syntax without executing owner preloads or runtime commands", async () => {
  expect(await validateCapabilities(mockDirectory(), [bunBaseline()])).toEqual([
    { capability: "bun", status: "skipped", reason: "bunfig.toml is missing" },
  ]);
  const { spy, commands, mounts } = mockContainer();
  try {
    const input = mockDirectory(
      new Map([
        ["bunfig.toml", 'preload = ["./owner.ts"]\n[run]\nbun = true\n'],
        ["owner.ts", 'throw new Error("must never execute");\n'],
      ]),
    );
    expect(await validateCapabilities(input, [bunBaseline()])).toEqual([
      { capability: "bun", status: "validated" },
    ]);
    expect(
      await validateCapabilities(
        mockDirectory(new Map([["bunfig.toml", "[invalid\n"]])),
        [bunBaseline()],
      ),
    ).toEqual([
      {
        capability: "bun",
        status: "failed",
        reason: "bun: bunfig.toml contains invalid TOML",
      },
    ]);
    expect(commands).toEqual([]);
    expect(mounts).toEqual([]);
    expect(await input.file("bunfig.toml").contents()).toContain(
      'preload = ["./owner.ts"]',
    );
  } finally {
    spy.mockRestore();
  }
});

test("generated tool build compiles a TypeScript CLI and clean removes the executable", () => {
  mkdirSync(join(process.cwd(), ".scratch"), { recursive: true });
  const folder = mkdtempSync(
    join(process.cwd(), ".scratch/tmp_rovo_bun_binary_"),
  );
  try {
    const project = buildProject("tool", "@scope/example", "tester");
    mkdirSync(join(folder, "src"));
    writeFileSync(
      join(folder, "package.json"),
      JSON.stringify(project.packageJson),
    );
    writeFileSync(
      join(folder, "src/message.ts"),
      'export const message: string = "standalone tool";\n',
    );
    writeFileSync(
      join(folder, "src/index.ts"),
      'import { message } from "./message.ts";\nconsole.log(message + ": " + Bun.argv[2]);\n',
    );
    const build = Bun.spawnSync([process.execPath, "run", "build"], {
      cwd: folder,
      timeout: 30_000,
    });
    expect(build.exitCode, build.stderr.toString()).toBe(0);
    const binary = Bun.spawnSync([join(folder, "dist/cli"), "hello"], {
      cwd: folder,
      env: { PATH: "/nonexistent" },
      timeout: 10_000,
    });
    expect(binary.exitCode, binary.stderr.toString()).toBe(0);
    expect(binary.stdout.toString().trim()).toBe("standalone tool: hello");
    const clean = Bun.spawnSync([process.execPath, "run", "clean"], {
      cwd: folder,
    });
    expect(clean.exitCode).toBe(0);
    expect(existsSync(join(folder, "dist"))).toBe(false);
    expect(existsSync(join(folder, "src/index.ts"))).toBe(true);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}, 45_000);
