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
import { TOOL_VERSIONS } from "../../src/core/versions.ts";

const repo = join(import.meta.dir, "../..");
let root: string;

beforeAll(() => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  root = mkdtempSync(join(repo, ".scratch/tmp_rovo_lint_e2e_"));
  const tools = join(root, "tools");
  mkdirSync(tools);
  writeFileSync(
    join(tools, "package.json"),
    JSON.stringify({
      private: true,
      devDependencies: { "npm-run-all2": TOOL_VERSIONS.npmRunAll2 },
    }),
  );
  execFileSync("bun", ["install", "--ignore-scripts"], {
    cwd: tools,
    timeout: 60_000,
    stdio: "pipe",
  });
  expect(existsSync(join(tools, "node_modules/.bin/lefthook"))).toBe(false);
}, 90_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

for (const kind of ["library", "tool", "forge-app", "agent-skill"]) {
  test(`Dagger-generated ${kind} lint runs from Bun and npm without Git or Lefthook`, () => {
    const input = join(root, `${kind}-input`);
    const app = join(root, `${kind} project`);
    mkdirSync(input);
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
        input,
        "--profile",
        kind,
        "--owner",
        "tester",
        "--package-name",
        "sample",
        ...(kind === "library" || kind === "tool"
          ? ["--without-functions", "fallow"]
          : []),
        "export",
        "--path",
        app,
      ],
      { cwd: repo, timeout: 120_000, stdio: "pipe" },
    );
    const pkg = JSON.parse(readFileSync(join(app, "package.json"), "utf8"));
    expect(pkg.devDependencies["npm-run-all2"]).toBe(TOOL_VERSIONS.npmRunAll2);
    const leaves = [
      "lint:check",
      "format:check",
      "typecheck",
      ...(kind === "forge-app" ? ["lint:prelint", "lint:forge"] : []),
    ];
    // Exercise generated composition, not the unrelated tools or Forge credentials.
    for (const name of leaves) pkg.scripts[name] = `printf '${name}-ran\\n'`;
    pkg.scripts["lint:check:synthetic"] = "printf 'synthetic-ran\\n'";
    for (const name of ["lint:fix", "lint:docs", "lint:check:synthetic:watch"])
      pkg.scripts[name] = "exit 23";
    writeFileSync(join(app, "package.json"), JSON.stringify(pkg));
    rmSync(join(app, "lefthook.yml"));
    symlinkSync(join(root, "tools/node_modules"), join(app, "node_modules"));
    const env = { ...process.env, GIT_CEILING_DIRECTORIES: root, CI: "true" };
    expect(existsSync(join(app, ".git"))).toBe(false);
    expect(
      spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
        cwd: app,
        env,
      }).status,
    ).not.toBe(0);
    for (const manager of ["bun", "npm"]) {
      const result = spawnSync(manager, ["run", "lint"], {
        cwd: app,
        env,
        encoding: "utf8",
        timeout: 20_000,
      });
      const output = result.stdout + result.stderr;
      expect(result.status, output).toBe(0);
      for (const leaf of leaves) {
        expect(
          output
            .split(/\r?\n/)
            .filter((line) => line.trimEnd().endsWith(`] ${leaf}-ran`)),
          output,
        ).toHaveLength(1);
      }
      expect(output).toContain("[lint:check:synthetic");
      expect(output).not.toContain("[lint:check:fallow");
      if (kind !== "forge-app") {
        expect(output).not.toContain("[lint:check:forge");
        expect(output).not.toContain("[lint:check:prelint");
      }
    }
  }, 180_000);
}
