import { expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { dag } from "@dagger.io/dagger";
import { DropCalf } from "../../src/index.ts";
import { kinds } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const scratch = join(import.meta.dir, "../../.scratch");
const artifacts = [
  "node_modules/example/index.js",
  "package-lock.json",
  "dist/nested/index.js",
];
const authored = new Map([
  ["src/index.ts", "export const answer = 42;\n"],
  ["tsconfig.json", '{"compilerOptions":{"strict":true}}\n'],
  ["README.md", "# Owner documentation\n"],
  ["bun.lock", "owner lockfile\n"],
]);

function checkCleanup(pkg: string, kind: string, present: string[]) {
  const root = mkdtempSync(join(scratch, "tmp_rovo_clean_build_"));
  const preserved = new Map([["package.json", pkg], ...authored]);
  try {
    for (const [path, contents] of [
      ...preserved,
      ...present.map((path) => [path, "generated artifact"] as const),
    ]) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    for (let run = 0; run < 2; run++) {
      const result = spawnSync("bun", ["run", "clean"], {
        cwd: root,
        encoding: "utf8",
        timeout: 10_000,
      });
      expect(result.status, result.stderr).toBe(0);
      expect(existsSync(join(root, "dist"))).toBe(false);
      for (const path of artifacts.slice(0, 2))
        expect(existsSync(join(root, path)), `${kind}: ${path}`).toBe(
          kind !== "library" && present.includes(path),
        );
      if (kind === "library")
        expect(existsSync(join(root, "node_modules"))).toBe(false);
      for (const [path, contents] of preserved)
        expect(readFileSync(join(root, path), "utf8"), path).toBe(contents);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test.each(kinds)(
  "%s initialized and maintained clean scripts remove only their generated artifacts",
  async (kind) => {
    mkdirSync(scratch, { recursive: true });
    const source = mockModuleSource();
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      const updated = await module.update(
        initialized.withNewFile(
          "package.json",
          JSON.stringify({
            ...pkg,
            scripts: { ...pkg.scripts, clean: "rm -rf dist" },
          }),
        ),
        kind,
      );
      for (const directory of [initialized, updated]) {
        const manifest = await directory.file("package.json").contents();
        for (let mask = 0; mask < 8; mask++)
          checkCleanup(
            manifest,
            kind,
            artifacts.filter((_, index) => mask & (1 << index)),
          );
      }
    } finally {
      stub.mockRestore();
      source.mockRestore();
    }
  },
);
