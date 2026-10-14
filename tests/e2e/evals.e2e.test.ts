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
import { promptfooTemplates } from "../support/templates-source.ts";

const repo = join(import.meta.dir, "../..");

function report(directory: string): {
  capability: string;
  status: string;
  reason?: string;
} {
  const output = execFileSync(
    "dagger",
    [
      "--progress",
      "plain",
      "call",
      "-m",
      repo,
      "validate",
      "--directory",
      directory,
      "--profile",
      "forge-app",
      "--with-functions",
      "evals",
    ],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 240_000,
      stdio: "pipe",
      env: { ...process.env, DAGGER_NO_NAG: "1" },
    },
  );
  return JSON.parse(output).find(
    (entry: { capability: string }) => entry.capability === "evals",
  );
}

test("Dagger evals checks native config acceptance without model calls or suite changes", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_evals_e2e_"));
  const configPath = join(root, "promptfooconfig.yaml");
  const ownerConfig =
    "prompts: ['owner prompt']\nproviders: ['echo']\ntests:\n  - vars: {}\n    assert:\n      - type: javascript\n        value: \"throw new Error('assertions must not run')\"\n";
  try {
    const seed = promptfooTemplates();
    for (const [path, contents] of seed) {
      const target = join(root, path);
      mkdirSync(join(target, ".."), { recursive: true });
      writeFileSync(target, contents);
    }
    const seeded = report(root);
    expect(seeded.status, seeded.reason).toBe("validated");
    for (const [path, contents] of seed)
      expect(readFileSync(join(root, path), "utf8")).toBe(contents);
    writeFileSync(configPath, ownerConfig);
    const accepted = report(root);
    expect(accepted.status, accepted.reason).toBe("validated");
    expect(readFileSync(configPath, "utf8")).toBe(ownerConfig);
    const missingTests =
      "prompts: ['owner']\nproviders: ['echo']\ntests: file://missing-tests.yaml\n";
    writeFileSync(configPath, missingTests);
    const emptySuite = report(root);
    expect(emptySuite.status, emptySuite.reason).toBe("validated");
    expect(readFileSync(configPath, "utf8")).toBe(missingTests);
    for (const config of [
      "prompts: [\n",
      "prompts: ['owner']\nproviders: ['not-a-valid-provider']\n",
      "prompts: ['owner']\nproviders: 123\n",
    ]) {
      writeFileSync(configPath, config);
      const failed = report(root);
      expect(failed.status, failed.reason).toBe("failed");
      expect(failed.reason).toContain("evals:");
      expect(readFileSync(configPath, "utf8")).toBe(config);
    }
    rmSync(configPath);
    expect(report(root)).toEqual({
      capability: "evals",
      status: "skipped",
      reason: "promptfooconfig.yaml is missing",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900_000);
