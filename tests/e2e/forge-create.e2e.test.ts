import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * End to end: `forge create` -> `init-changes` -> export.
 *
 * Opt in with `DROP_CALF_E2E=1`. It needs the Forge CLI logged in, a Dagger
 * engine, and network access, and **`forge create` registers a real app** in
 * your developer space, so a run leaves one behind.
 *
 *   DROP_CALF_E2E=1 bun test tests/e2e
 *
 * `FORGE_E2E_TEMPLATE` (default `blank`) picks the template and
 * `FORGE_E2E_DEV_SPACE` passes `--developer-space-id` for non-interactive runs.
 */
const enabled = process.env.DROP_CALF_E2E === "1";
const repo = join(import.meta.dir, "../..");
const template = process.env.FORGE_E2E_TEMPLATE ?? "blank";
const space = process.env.FORGE_E2E_DEV_SPACE;

const run = (file: string, args: string[], cwd: string) =>
  execFileSync(file, args, { cwd, encoding: "utf8", stdio: "pipe" });
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

describe.skipIf(!enabled)("forge create then init", () => {
  test("a fresh scaffold becomes a Drop Calf project and keeps its app", () => {
    const root = mkdtempSync(join(tmpdir(), "drop-calf-e2e-"));
    const app = join(root, "app");
    try {
      run(
        "forge",
        [
          "create",
          `drop-calf-e2e-${Date.now()}`,
          "--template",
          template,
          "--directory",
          "app",
          "--accept-terms",
          ...(space ? ["--developer-space-id", space] : []),
        ],
        root,
      );
      const scaffold = readJson(join(app, "package.json"));
      const manifest = readFileSync(join(app, "manifest.yml"), "utf8");

      run(
        "dagger",
        [
          "call",
          "-m",
          repo,
          "init-changes",
          "--directory",
          app,
          "--profile",
          "forge-app",
          "--owner",
          "tester",
          "export",
          "--path",
          app,
        ],
        root,
      );

      const result = readJson(join(app, "package.json"));
      // The app keeps what `forge create` gave it.
      for (const [name, version] of Object.entries(
        scaffold.dependencies ?? {},
      ) as [string, string][])
        expect(result.dependencies[name]).toBe(version);
      expect(result.name).toBe(scaffold.name);
      expect(readFileSync(join(app, "manifest.yml"), "utf8")).toBe(manifest);
      // Drop Calf's files arrived, and the scaffold's replaced ones did not.
      for (const path of ["tsconfig.json", "lefthook.yml", ".gitignore"])
        expect(existsSync(join(app, path))).toBe(true);
      for (const path of [".eslintrc", "package-lock.json"])
        expect(existsSync(join(app, path))).toBe(false);
      expect(result.scripts.lint).not.toBe(scaffold.scripts?.lint);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 600_000);
});
