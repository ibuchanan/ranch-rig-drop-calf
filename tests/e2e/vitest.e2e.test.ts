import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";

const repo = join(import.meta.dir, "../..");
function call(...args: string[]) {
  return execFileSync(
    "dagger",
    ["--progress", "plain", "call", "-m", repo, ...args],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 240_000,
      stdio: "pipe",
      env: { ...process.env, DAGGER_NO_NAG: "1" },
    },
  );
}
function report(directory: string): { status: string; reason?: string } {
  const result = JSON.parse(
    call("validate", "--directory", directory, "--profile", "forge-app"),
  ).find((entry: { capability: string }) => entry.capability === "test");
  return result;
}
const config =
  "import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: { globals: true, coverage: { provider: 'v8' } } });\n";

test("Dagger Vitest accepts an empty suite, lists files without imports and keeps config read-only", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_vitest_e2e_"));
  try {
    writeFileSync(join(root, "vitest.config.ts"), config);
    mkdirSync(join(root, "coverage"));
    writeFileSync(join(root, "coverage/owner.txt"), "do not delete");
    expect(report(root).status).toBe("validated");
    writeFileSync(
      join(root, "setup.ts"),
      "throw new Error('setup must not execute');\n",
    );
    writeFileSync(
      join(root, "vitest.config.ts"),
      config.replace(
        "globals: true",
        "globals: true, setupFiles: ['./setup.ts'], globalSetup: ['./setup.ts']",
      ),
    );
    writeFileSync(
      join(root, "broken.test.ts"),
      "throw new Error('test modules must not be imported');\n",
    );
    expect(report(root).status).toBe("validated");
    expect(readFileSync(join(root, "vitest.config.ts"), "utf8")).toBe(
      config.replace(
        "globals: true",
        "globals: true, setupFiles: ['./setup.ts'], globalSetup: ['./setup.ts']",
      ),
    );
    expect(readFileSync(join(root, "coverage/owner.txt"), "utf8")).toBe(
      "do not delete",
    );
    writeFileSync(
      join(root, "vitest.config.ts"),
      "throw new Error('owner config cannot load');\n",
    );
    const broken = report(root);
    expect(broken.status).toBe("failed");
    expect(broken.reason).toContain("owner config cannot load");
    rmSync(join(root, "vitest.config.ts"));
    expect(report(root).status).toBe("skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900_000);

test("Dagger Vitest accepts custom coverage, rejects missing providers and provider version mismatches", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_vitest_e2e_"));
  try {
    writeFileSync(
      join(root, "vitest.config.ts"),
      "export default { test: { coverage: { provider: 'custom', customProviderModule: './provider.ts' } } };\n",
    );
    writeFileSync(
      join(root, "provider.ts"),
      "export default { getProvider: () => ({ name: 'owner', initialize() { }, resolveOptions() { return { provider: 'custom' }; } }) };\n",
    );
    expect(report(root).status).toBe("validated");
    rmSync(join(root, "provider.ts"));
    expect(report(root).status).toBe("failed");
    writeFileSync(join(root, "vitest.config.ts"), config);
    const provider = join(root, "node_modules/@vitest/coverage-v8");
    mkdirSync(provider, { recursive: true });
    writeFileSync(
      join(provider, "package.json"),
      '{"name":"@vitest/coverage-v8","version":"0.0.0","type":"module","exports":"./index.js"}',
    );
    writeFileSync(
      join(provider, "index.js"),
      "export default { getProvider: () => ({ version: '0.0.0', initialize() { throw new Error('mismatch must fail before initialization'); } }) };\n",
    );
    const mismatch = report(root);
    expect(mismatch.status).toBe("failed");
    expect(mismatch.reason).toContain("incompatible with vitest@");
    rmSync(join(root, "node_modules"), { recursive: true });
    writeFileSync(
      join(root, "package.json"),
      '{"private":true,"type":"module"}',
    );
    execFileSync(
      "bun",
      [
        "add",
        "--cwd",
        root,
        "--ignore-scripts",
        `vitest@${TOOL_VERSIONS.vitest}`,
        `@vitest/coverage-istanbul@${TOOL_VERSIONS.vitest}`,
      ],
      { stdio: "pipe", timeout: 120_000 },
    );
    writeFileSync(
      join(root, "vitest.config.ts"),
      config.replace("provider: 'v8'", "provider: 'istanbul'"),
    );
    const istanbul = report(root);
    expect(istanbul.status, istanbul.reason).toBe("validated");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900_000);
