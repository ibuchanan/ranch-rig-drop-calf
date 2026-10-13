import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const repo = join(import.meta.dir, "../..");

for (const { name, config, status, base } of [
  {
    name: "seed",
    config: readFileSync(
      join(repo, "templates/git-hooks/lefthook.yml"),
      "utf8",
    ),
    status: "validated",
  },
  {
    name: "owner commands are not executed or checked against npm scripts",
    config:
      "pre-commit:\n  commands:\n    owner:\n      run: touch ran-hook; npm run missing\n",
    status: "validated",
  },
  {
    name: "relative extends",
    config: "extends:\n  - base.yml\n",
    base: "pre-commit:\n  commands:\n    owner:\n      run: touch ran-hook\n",
    status: "validated",
  },
  {
    name: "invalid extended config",
    config: "extends:\n  - base.yml\n",
    base: "colors: [invalid]\n",
    status: "failed",
  },
  {
    name: "missing relative extends is accepted by Lefthook",
    config: "extends:\n  - missing.yml\n",
    status: "validated",
  },
  {
    name: "invalid schema value",
    config: "colors: [invalid]\n",
    status: "failed",
  },
  { name: "malformed YAML", config: "pre-commit: [\n", status: "failed" },
  { name: "missing config", config: undefined, status: "skipped" },
]) {
  test(`Dagger git-hooks validation: ${name}`, () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_git_hooks_e2e_"));
    try {
      if (config !== undefined)
        writeFileSync(join(root, "lefthook.yml"), config);
      if (base !== undefined) writeFileSync(join(root, "base.yml"), base);
      // A worktree pointer must not be followed; validation uses disposable metadata.
      writeFileSync(join(root, ".git"), "gitdir: /does-not-exist\n");
      const report = JSON.parse(
        execFileSync(
          "dagger",
          [
            "--progress",
            "plain",
            "call",
            "-m",
            repo,
            "validate",
            "--directory",
            root,
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
        ),
      );
      const result = report.find(
        (entry: { capability: string }) => entry.capability === "git-hooks",
      );
      expect(result.status).toBe(status);
      if (status !== "validated")
        expect(result.reason.length).toBeGreaterThan(0);
      if (config !== undefined)
        expect(readFileSync(join(root, "lefthook.yml"), "utf8")).toBe(config);
      if (base !== undefined)
        expect(readFileSync(join(root, "base.yml"), "utf8")).toBe(base);
      expect(readFileSync(join(root, ".git"), "utf8")).toBe(
        "gitdir: /does-not-exist\n",
      );
      expect(existsSync(join(root, "ran-hook"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
}
