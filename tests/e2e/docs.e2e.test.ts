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
      "agent-skill",
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
    (entry: { capability: string }) => entry.capability === "docs",
  );
}

test("Dagger docs validation loads owner configs without linting or fixing content", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_docs_e2e_"));
  const markdownPath = join(root, ".markdownlint-cli2.jsonc");
  const spellingPath = join(root, ".cspell.jsonc");
  const markdown =
    '{"globs":["**/*.md"],"fix":true,"config":{"MD013":false}}\n';
  const spelling =
    '{"version":"0.2","words":["myprojectword"],"language":"en-GB"}\n';
  const content = "BADDDDD words\n## broken heading\n";
  try {
    writeFileSync(markdownPath, markdown);
    writeFileSync(spellingPath, spelling);
    writeFileSync(join(root, "README.md"), content);
    const accepted = report(root);
    expect(accepted.status, accepted.reason).toBe("validated");
    expect(readFileSync(markdownPath, "utf8")).toBe(markdown);
    expect(readFileSync(spellingPath, "utf8")).toBe(spelling);
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe(content);
    for (const [path, contents, diagnostic] of [
      [markdownPath, "{", "parse"],
      [spellingPath, "{", "parse"],
      [markdownPath, '{"config":{"extends":"./missing.json"}}', "missing.json"],
      [spellingPath, '{"import":["./missing.json"]}', "missing.json"],
    ] as const) {
      writeFileSync(markdownPath, markdown);
      writeFileSync(spellingPath, spelling);
      writeFileSync(path, contents);
      const broken = report(root);
      expect(broken.status, broken.reason).toBe("failed");
      expect(broken.reason).toContain(diagnostic);
      expect(readFileSync(path, "utf8")).toBe(contents);
      expect(readFileSync(join(root, "README.md"), "utf8")).toBe(content);
    }
    rmSync(markdownPath);
    expect(report(root)).toEqual({
      capability: "docs",
      status: "failed",
      reason: ".markdownlint-cli2.jsonc is missing",
    });
    rmSync(spellingPath);
    expect(report(root).status).toBe("skipped");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 900_000);
