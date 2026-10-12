import { expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
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
import { TOOL_VERSIONS } from "../../src/versions.ts";
import { mockDirectory, mockModuleSource } from "../module-source.ts";

const enabled = process.env.DROP_CALF_LIBRARY_BUILD_E2E === "1";
const repo = join(import.meta.dir, "../..");

test.skipIf(!enabled)(
  "generated library builds ESM/CJS, maps and both declaration formats for multiple entries",
  async () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_library_build_"));
    const source = mockModuleSource();
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const generated = (await new DropCalf().init(
        mockDirectory(),
        "library",
        "tester",
        "sample-library",
      )) as ReturnType<typeof mockDirectory>;
      for (const [path, contents] of generated.files) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), contents);
      }
      // Install only the tools used by this workflow, not unrelated starter dependencies.
      const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
      pkg.devDependencies = {};
      writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
      execFileSync(
        "bun",
        [
          "add",
          "--cwd",
          root,
          "--ignore-scripts",
          `tsdown@${TOOL_VERSIONS.tsdown}`,
          `typescript@${TOOL_VERSIONS.typescript}`,
        ],
        { stdio: "pipe", timeout: 120_000 },
      );
      mkdirSync(join(root, "src/testing"), { recursive: true });
      writeFileSync(
        join(root, "src/index.ts"),
        "export function answer(value: number): number { return value + 1; }\n",
      );
      writeFileSync(
        join(root, "src/testing/helper.ts"),
        "export const helper: number = 42;\n",
      );
      const config = JSON.parse(
        readFileSync(join(root, "tsdown.config.json"), "utf8"),
      );
      config.entry["testing/helper"] = "./src/testing/helper.ts";
      writeFileSync(join(root, "tsdown.config.json"), JSON.stringify(config));
      execFileSync("bun", ["run", "--bun", "build"], {
        cwd: root,
        stdio: "pipe",
        timeout: 120_000,
      });
      for (const entry of ["index", "testing/helper"])
        for (const extension of [
          "mjs",
          "cjs",
          "mjs.map",
          "cjs.map",
          "d.ts",
          "d.cts",
        ])
          expect(existsSync(join(root, `dist/${entry}.${extension}`))).toBe(
            true,
          );
      expect(
        readFileSync(join(root, "dist/testing/helper.d.cts"), "utf8"),
      ).toBe(readFileSync(join(root, "dist/testing/helper.d.ts"), "utf8"));
      const run = (code: string) =>
        execFileSync("bun", ["-e", code], {
          cwd: root,
          encoding: "utf8",
          stdio: "pipe",
        }).trim();
      expect(
        run("import {answer} from 'sample-library'; console.log(answer(41));"),
      ).toBe("42");
      expect(run("console.log(require('sample-library').answer(41));")).toBe(
        "42",
      );
      writeFileSync(
        join(root, "consumer.mts"),
        "import {answer} from 'sample-library'; const result: number = answer(41);\n",
      );
      writeFileSync(
        join(root, "consumer.cts"),
        "import {answer} from 'sample-library'; const result: number = answer(41);\n",
      );
      execFileSync(
        "bun",
        [
          "run",
          "--bun",
          "tsc",
          "--noEmit",
          "--strict",
          "--module",
          "NodeNext",
          "--moduleResolution",
          "NodeNext",
          "--target",
          "ES2022",
          "consumer.mts",
          "consumer.cts",
        ],
        { cwd: root, stdio: "pipe", timeout: 120_000 },
      );
    } finally {
      stub.mockRestore();
      source.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  },
  300_000,
);
