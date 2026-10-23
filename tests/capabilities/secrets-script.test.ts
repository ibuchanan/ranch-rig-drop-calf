import { afterEach, beforeEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = join(
  import.meta.dir,
  "../../templates/secretspec/scripts/forge-vars-from-secretspec.js",
);

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), "forge-vars-"));
  mkdirSync(join(project, "scripts"));
  mkdirSync(join(project, "bin"));
  cpSync(source, join(project, "scripts/forge-vars-from-secretspec.js"));
  writeFileSync(join(project, "secretspec.toml"), "");
  // SecretSpec injects secrets, then runs the command after `--`; here the test's own
  // environment stands in for the injected secrets.
  stub(
    "secretspec",
    'while [ "$1" != "--" ]; do shift; done\nshift\nexec "$@"',
  );
  stub("forge", 'printf "%s\\n" "$*" >> "$FORGE_LOG"');
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function stub(name: string, body: string) {
  const path = join(project, "bin", name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(keys: unknown, env: Record<string, string> = {}) {
  writeFileSync(
    join(project, "forge-variable-keys.json"),
    JSON.stringify(keys),
  );
  const result = spawnSync(
    process.execPath,
    [join(project, "scripts/forge-vars-from-secretspec.js")],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(project, "bin")}:${process.env.PATH}`,
        FORGE_LOG: join(project, "forge.log"),
        ...env,
      },
    },
  );
  const log = join(project, "forge.log");
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    pushed: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [],
  };
}

test("pushes each declared variable, encrypted, to the selected Forge environment", () => {
  const result = run(["API_TOKEN", "REGION"], {
    API_TOKEN: "t0ken",
    REGION: "eu",
    FORGE_ENVIRONMENT: "staging",
  });
  expect(result.status).toBe(0);
  expect(result.pushed).toEqual([
    "variables set API_TOKEN t0ken --environment staging --encrypt",
    "variables set REGION eu --environment staging --encrypt",
  ]);
});

test("defaults to the development environment", () => {
  const result = run(["API_TOKEN"], { API_TOKEN: "t0ken" });
  expect(result.pushed).toEqual([
    "variables set API_TOKEN t0ken --environment development --encrypt",
  ]);
});

test("an empty declaration is a successful no-op", () => {
  const result = run([]);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("No app-level Forge variables declared");
  expect(result.pushed).toEqual([]);
});

test("a missing value stops before any variable is pushed, without echoing values", () => {
  const result = run(["API_TOKEN", "REGION"], { API_TOKEN: "t0ken" });
  expect(result.status).toBe(1);
  expect(result.pushed).toEqual([]);
  expect(result.stderr).toContain("Forge variable push failed");
  expect(result.stderr).not.toContain("t0ken");
});

test.each([
  ["a non-array", { API_TOKEN: 1 }],
  ["a non-string key", [1]],
  ["an invalid name", ["not-valid"]],
  ["duplicates", ["A", "A"]],
  ["a Forge CLI variable", ["FORGE_EMAIL"]],
])("rejects %s before touching SecretSpec or Forge", (_name, keys) => {
  const result = run(keys, { A: "x", FORGE_EMAIL: "x" });
  expect(result.status).toBe(1);
  expect(result.pushed).toEqual([]);
});
