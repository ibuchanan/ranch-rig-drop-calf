import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { buildProject } from "../../src/profiles.ts";

// Opt in: requires Dagger and network access, but never registers or deploys an app.
const enabled = process.env.DROP_CALF_TESTING_E2E === "1";
const repo = join(import.meta.dir, "../..");
let root: string;

const run = (cwd: string, args: string[]) =>
  spawnSync("bun", args, {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, CI: "true" },
  });

beforeAll(() => {
  if (!enabled) return;
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  root = mkdtempSync(join(repo, ".scratch/tmp_rovo_testing_"));
  const tools = join(root, "tools");
  mkdirSync(tools);
  const deps = buildProject("forge-app", "sample", "tester").packageJson
    .devDependencies;
  // Install only the tools exercised here; unrelated Git-sourced dependencies
  // are not needed to run the scaffold's test and typecheck scripts.
  writeFileSync(
    join(tools, "package.json"),
    JSON.stringify({
      private: true,
      devDependencies: Object.fromEntries(
        ["vitest", "@vitest/coverage-v8", "typescript", "@types/node"].map(
          (name) => [name, deps[name]],
        ),
      ),
    }),
  );
  const installed = run(tools, ["install", "--ignore-scripts"]);
  expect(installed.status, installed.stdout + installed.stderr).toBe(0);
}, 120_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

test.skipIf(!enabled).each(["empty", "initialized"])(
  "%s Forge scaffold tests and typechecks independently of the handler build",
  (mode) => {
    const app = join(root, mode);
    mkdirSync(app, { recursive: true });
    if (mode === "initialized") {
      mkdirSync(join(app, "src"), { recursive: true });
      writeFileSync(
        join(app, "package.json"),
        '{"name":"sample","scripts":{"test":"stale"}}',
      );
      writeFileSync(
        join(app, "src/index.ts"),
        "export const run = () => undefined;\n",
      );
    }
    execFileSync(
      "dagger",
      [
        "--progress",
        "plain",
        "call",
        "-m",
        repo,
        "init",
        "--directory",
        app,
        "--package-name",
        "sample",
        "--profile",
        "forge-app",
        "--owner",
        "tester",
        "export",
        "--path",
        app,
      ],
      { cwd: repo, encoding: "utf8", timeout: 120_000, stdio: "pipe" },
    );
    symlinkSync(join(root, "tools/node_modules"), join(app, "node_modules"));
    const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
    for (const script of ["test", "test:watch", "test:coverage"]) {
      // Watch intentionally stays alive interactively; --run exercises its
      // startup and empty-suite behavior without leaving a watcher behind.
      const result = run(app, [
        "run",
        script,
        ...(script === "test:watch" ? ["--run"] : []),
      ]);
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(result.stdout + result.stderr).toContain("No test files found");
      expect(pkg.scripts[script]).toContain("--passWithNoTests");
    }
    for (const path of [
      "specs/reference",
      "dist",
      "coverage",
      "node_modules/excluded",
    ]) {
      mkdirSync(join(app, path), { recursive: true });
      writeFileSync(
        join(app, path, "excluded.test.ts"),
        'throw new Error("excluded test was discovered");\n',
      );
    }
    const excluded = run(app, ["run", "test"]);
    expect(excluded.status, excluded.stdout + excluded.stderr).toBe(0);
    expect(excluded.stdout + excluded.stderr).toContain("No test files found");
    mkdirSync(join(app, "tests"), { recursive: true });
    writeFileSync(
      join(app, "tests/broken.test.ts"),
      'import { expect, test } from "vitest";\ntest("broken", () => { const value: number = "wrong"; expect(value).toBe(1); });\n',
    );
    const broken = run(app, ["run", "typecheck"]);
    expect(broken.status, broken.stdout + broken.stderr).not.toBe(0);
    expect(broken.stdout + broken.stderr).toContain("tests/broken.test.ts");
    expect(broken.stdout + broken.stderr).toContain("TS2322");
    writeFileSync(
      join(app, "tests/broken.test.ts"),
      'import { expect, test } from "vitest";\ntest("valid", () => expect(1).toBe(1));\n',
    );
    const valid = run(app, ["run", "typecheck"]);
    expect(valid.status, valid.stdout + valid.stderr).toBe(0);
    const tests = run(app, ["run", "test"]);
    expect(tests.status, tests.stdout + tests.stderr).toBe(0);
    const coverage = run(app, ["run", "test:coverage"]);
    expect(coverage.status, coverage.stdout + coverage.stderr).toBe(0);
    expect(existsSync(join(app, "coverage/index.html"))).toBe(true);
    const configPath = join(app, "vitest.config.ts");
    const config = readFileSync(configPath, "utf8");
    writeFileSync(configPath, `${config}\nconst invalid: number = "wrong";\n`);
    const invalidConfig = run(app, ["run", "typecheck"]);
    expect(
      invalidConfig.status,
      invalidConfig.stdout + invalidConfig.stderr,
    ).not.toBe(0);
    expect(invalidConfig.stdout + invalidConfig.stderr).toContain(
      "vitest.config.ts",
    );
    writeFileSync(configPath, config);
    mkdirSync(join(app, "src"), { recursive: true });
    writeFileSync(
      join(app, "src/index.ts"),
      "export const run = () => undefined;\n",
    );
    // A broken test must not enter the deploy-time handler build.
    writeFileSync(
      join(app, "tests/broken.test.ts"),
      'const invalid: number = "wrong";\n',
    );
    const build = run(app, ["run", "build"]);
    expect(build.status, build.stdout + build.stderr).toBe(0);
  },
  180_000,
);
