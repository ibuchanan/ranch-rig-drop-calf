import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { buildProject } from "../../src/composition/profiles.ts";

const repo = join(import.meta.dir, "../..");

test.each([
  "successful hooks",
  "unusable Git metadata",
  "missing Git metadata",
])(
  "library preparation builds before best-effort hook installation: %s",
  (scenario) => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_library_prepare_"));
    try {
      const pkg = buildProject(
        "library",
        "prepare-fixture",
        "tester",
      ).packageJson;
      pkg.scripts.build = "printf 'build\\n' >> lifecycle.log";
      writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
      mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
      const hook = join(root, "node_modules/.bin/lefthook");
      writeFileSync(
        hook,
        "#!/bin/sh\nprintf 'hooks\\n' >> lifecycle.log\n" +
          (scenario === "successful hooks"
            ? "exit 0\n"
            : "git rev-parse --git-dir\n"),
      );
      chmodSync(hook, 0o755);
      if (scenario === "unusable Git metadata")
        writeFileSync(join(root, ".git"), "gitdir: /does-not-exist\n");
      const result = spawnSync("bun", ["run", "--bun", "prepare"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
        env: { ...process.env, GIT_CEILING_DIRECTORIES: dirname(root) },
      });
      expect(result.status, result.stdout + result.stderr).toBe(0);
      expect(readFileSync(join(root, "lifecycle.log"), "utf8")).toBe(
        "build\nhooks\n",
      );
      if (scenario !== "successful hooks")
        expect(result.stderr).toContain("not a git repository");
      if (scenario === "unusable Git metadata") {
        expect(readFileSync(join(root, ".git"), "utf8")).toBe(
          "gitdir: /does-not-exist\n",
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("library preparation stops on build failure before installing hooks", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_library_prepare_"));
  try {
    const pkg = buildProject(
      "library",
      "prepare-fixture",
      "tester",
    ).packageJson;
    pkg.scripts.build = "echo deliberate-build-failure >&2; exit 23";
    writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
    mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
    const hook = join(root, "node_modules/.bin/lefthook");
    writeFileSync(hook, "#!/bin/sh\necho hooks >> lifecycle.log\n");
    chmodSync(hook, 0o755);
    const result = spawnSync("bun", ["run", "--bun", "prepare"], {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    });
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("deliberate-build-failure");
    expect(existsSync(join(root, "lifecycle.log"))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
