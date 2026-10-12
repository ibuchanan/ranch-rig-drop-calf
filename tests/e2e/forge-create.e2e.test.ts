import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  forgeRuntimeFromNvmrc,
  reconcileForgeRuntime,
} from "../../src/forge-manifest.ts";
import { planScaffoldTypeScript } from "../../src/init.ts";
import { NODE_NVMRC } from "../../src/node.ts";

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
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_forge_create_"));
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
      const sourcePaths = readdirSync(join(app, "src"), {
        recursive: true,
      }).map((path) => `src/${path}`);
      const adoption = planScaffoldTypeScript(sourcePaths, manifest);
      const sourceBytes = new Map(
        adoption.renames.map(({ from }) => [
          from,
          readFileSync(join(app, from), "utf8"),
        ]),
      );

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
      expect(readFileSync(join(app, "manifest.yml"), "utf8")).toBe(
        reconcileForgeRuntime(
          adoption.manifest ?? manifest,
          forgeRuntimeFromNvmrc(NODE_NVMRC),
        ),
      );
      for (const { from, to } of adoption.renames) {
        expect(existsSync(join(app, from))).toBe(false);
        expect(readFileSync(join(app, to), "utf8")).toBe(
          sourceBytes.get(from) ?? "",
        );
      }
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
