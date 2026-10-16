import { expect, spyOn, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { dag } from "@dagger.io/dagger";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const repo = join(import.meta.dir, "../..");

test("installing a controlled Git dependency prepares its consumable library distributable", async () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_git_prepare_"));
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const generated = await new DropCalf().init(
      mockDirectory(),
      "library",
      "tester",
      "git-prepare-fixture",
    );
    const library = join(root, "library");
    for (const path of [
      "package.json",
      "scripts/build.sh",
      "tsdown.config.json",
      "tsconfig.json",
      "tsconfig.declarations.json",
      "lefthook.yml",
      ".npmrc",
    ]) {
      mkdirSync(dirname(join(library, path)), { recursive: true });
      writeFileSync(join(library, path), await generated.file(path).contents());
    }
    const pkg = JSON.parse(readFileSync(join(library, "package.json"), "utf8"));
    pkg.devDependencies = Object.fromEntries(
      ["tsdown", "typescript", "@types/node", "lefthook"].map((name) => [
        name,
        pkg.devDependencies[name],
      ]),
    );
    pkg.scripts = { build: pkg.scripts.build, prepare: pkg.scripts.prepare };
    writeFileSync(join(library, "package.json"), JSON.stringify(pkg));
    mkdirSync(join(library, "src"));
    writeFileSync(
      join(library, "src/index.ts"),
      "export const answer: number = 42;\n",
    );
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], {
        cwd: library,
        stdio: "pipe",
        timeout: 10_000,
      });
    git("init", "--quiet");
    git(
      "add",
      "package.json",
      "scripts/build.sh",
      "tsdown.config.json",
      "tsconfig.json",
      "tsconfig.declarations.json",
      "lefthook.yml",
      ".npmrc",
      "src/index.ts",
    );
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "test: Add controlled library",
    );
    expect(existsSync(join(library, "dist"))).toBe(false);
    const consumer = join(root, "consumer");
    mkdirSync(consumer);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({
        private: true,
        dependencies: {
          "git-prepare-fixture": `git+${pathToFileURL(library).href}`,
        },
      }),
    );
    mkdirSync(join(root, "tmp"));
    const installed = spawnSync(
      "bun",
      [
        "run",
        "--bun",
        "npm",
        "install",
        "--ignore-scripts=false",
        "--foreground-scripts",
        "--no-audit",
        "--no-fund",
      ],
      {
        cwd: consumer,
        encoding: "utf8",
        timeout: 180_000,
        env: {
          ...process.env,
          npm_config_cache: join(root, "cache"),
          TMPDIR: join(root, "tmp"),
          GIT_CEILING_DIRECTORIES: root,
        },
      },
    );
    expect(installed.status, installed.stdout + installed.stderr).toBe(0);
    for (const extension of ["mjs", "cjs", "d.ts", "d.cts"])
      expect(
        existsSync(
          join(
            consumer,
            `node_modules/git-prepare-fixture/dist/index.${extension}`,
          ),
        ),
      ).toBe(true);
    for (const code of [
      "import {answer} from 'git-prepare-fixture'; console.log(answer);",
      "console.log(require('git-prepare-fixture').answer);",
    ]) {
      expect(
        execFileSync("bun", ["-e", code], {
          cwd: consumer,
          encoding: "utf8",
        }).trim(),
      ).toBe("42");
    }
    expect(existsSync(join(library, "dist"))).toBe(false);
    expect(git("status", "--porcelain").toString()).toBe("");
  } finally {
    empty.mockRestore();
    source.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
