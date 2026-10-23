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
import { dag } from "@dagger.io/dagger";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const repo = join(import.meta.dir, "../..");

test("packed library supports ESM and CommonJS consumers with sibling declarations and owner subpaths", async () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_library_build_"));
  const source = mockModuleSource();
  const stub = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const module = new DropCalf();
    let generated = (await module.init(
      mockDirectory(),
      "library",
      "tester",
      "sample-library",
    )) as ReturnType<typeof mockDirectory>;
    const pkg = JSON.parse(await generated.file("package.json").contents());
    pkg.exports["./testing"] = {
      import: {
        types: "./dist/testing/helper.d.ts",
        default: "./dist/testing/helper.mjs",
      },
      require: {
        types: "./dist/testing/helper.d.cts",
        default: "./dist/testing/helper.cjs",
      },
    };
    pkg.sideEffects = false;
    pkg.publishConfig = { access: "public" };
    const config = JSON.parse(
      await generated.file("tsdown.config.json").contents(),
    );
    config.entry["testing/helper"] = "./src/testing/helper.ts";
    generated = (await module.update(
      generated
        .withNewFile("package.json", JSON.stringify(pkg))
        .withNewFile("tsdown.config.json", JSON.stringify(config)),
      "library",
    )) as typeof generated;
    const maintained = JSON.parse(
      await generated.file("package.json").contents(),
    );
    expect(maintained.exports).toEqual(pkg.exports);
    expect(maintained.sideEffects).toBe(false);
    expect(maintained.publishConfig).toEqual({ access: "public" });
    for (const [path, contents] of generated.files) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), contents);
    }
    // Install only the tools used by this workflow, not unrelated starter dependencies.
    maintained.devDependencies = {};
    writeFileSync(join(root, "package.json"), JSON.stringify(maintained));
    execFileSync(
      "bun",
      [
        "add",
        "--cwd",
        root,
        "--ignore-scripts",
        `tsdown@${TOOL_VERSIONS.tsdown}`,
        `typescript@${TOOL_VERSIONS.typescript}`,
        "@types/node@22",
      ],
      { stdio: "pipe", timeout: 120_000 },
    );
    mkdirSync(join(root, "src/testing"), { recursive: true });
    mkdirSync(join(root, "src/nested"), { recursive: true });
    writeFileSync(
      join(root, "src/index.ts"),
      'export { answer } from "./answer.js";\nexport type { Answer } from "./nested";\nexport type Literal = "./answer";\n',
    );
    writeFileSync(
      join(root, "src/answer.ts"),
      'import type { Answer } from "./nested/index.js";\nexport function answer(value: number): Answer { return { value: value + 1 }; }\n',
    );
    writeFileSync(
      join(root, "src/nested/index.ts"),
      "export interface Answer { value: number }\n",
    );
    writeFileSync(
      join(root, "src/testing/helper.ts"),
      'export { answer as helper } from "../answer";\nexport type Result = import("../nested").Answer;\n',
    );
    execFileSync("bun", ["run", "--bun", "build"], {
      cwd: root,
      stdio: "pipe",
      timeout: 120_000,
    });
    for (const entry of ["index", "testing/helper"])
      for (const extension of ["mjs", "cjs", "d.ts", "d.cts"])
        expect(
          existsSync(join(root, `dist/${entry}.${extension}`)),
          `dist/${entry}.${extension}`,
        ).toBe(true);

    const tarball = join(root, "consumer.tgz");
    execFileSync(
      "bun",
      ["pm", "pack", "--ignore-scripts", "--filename", tarball],
      {
        cwd: root,
        stdio: "pipe",
        timeout: 60_000,
      },
    );
    const consumer = join(root, "consumer");
    const installed = join(consumer, "node_modules/sample-library");
    mkdirSync(installed, { recursive: true });
    execFileSync("tar", [
      "-xzf",
      tarball,
      "--strip-components=1",
      "-C",
      installed,
    ]);
    // Consumers can only see the tarball, not the producer's source or dist tree.
    rmSync(join(root, "dist"), { recursive: true });
    rmSync(join(root, "src"), { recursive: true });
    const packed = JSON.parse(
      readFileSync(join(installed, "package.json"), "utf8"),
    );
    for (const path of [
      packed.main,
      packed.types,
      ...Object.values(packed.exports).flatMap((entry) =>
        Object.values(entry as Record<string, Record<string, string>>).flatMap(
          (condition) => Object.values(condition),
        ),
      ),
    ])
      expect(existsSync(join(installed, path))).toBe(true);
    writeFileSync(
      join(consumer, "package.json"),
      '{"private":true,"type":"module"}',
    );
    const run = (code: string) =>
      execFileSync("bun", ["-e", code], {
        cwd: consumer,
        encoding: "utf8",
        stdio: "pipe",
      }).trim();
    expect(
      run(
        "import {answer} from 'sample-library'; import {helper} from 'sample-library/testing'; console.log(answer(41).value, helper(41).value);",
      ),
    ).toBe("42 42");
    expect(
      run(
        "console.log(require('sample-library').answer(41).value, require('sample-library/testing').helper(41).value);",
      ),
    ).toBe("42 42");
    const imports =
      'import { answer, type Answer, type Literal } from "sample-library";\nimport { helper, type Result } from "sample-library/testing";\nconst result: Answer = answer(41);\nconst other: Result = helper(result.value);\nconst literal: Literal = "./answer";\n';
    writeFileSync(join(consumer, "consumer.mts"), imports);
    writeFileSync(
      join(consumer, "consumer.cts"),
      `${imports}import library = require("sample-library");\nconst required: Answer = library.answer(other.value);\n`,
    );
    writeFileSync(
      join(consumer, "legacy.cts"),
      'import library = require("sample-library");\nconst result: library.Answer = library.answer(41);\n',
    );
    for (const [moduleKind, resolution] of [
      ["Node16", "Node16"],
      ["NodeNext", "NodeNext"],
      ["ESNext", "Bundler"],
      ["CommonJS", "Node10"],
    ] as const) {
      const result = spawnSync(
        "bun",
        [
          "run",
          "--bun",
          join(root, "node_modules/typescript/bin/tsc"),
          "--noEmit",
          "--strict",
          "--types",
          "node",
          "--module",
          moduleKind,
          "--moduleResolution",
          resolution,
          "--target",
          "ES2022",
          ...(resolution === "Node10"
            ? ["legacy.cts"]
            : [
                "consumer.mts",
                ...(resolution === "Bundler" ? [] : ["consumer.cts"]),
              ]),
        ],
        { cwd: consumer, encoding: "utf8", timeout: 120_000 },
      );
      expect(
        result.status,
        `${resolution}: ${result.stdout}${result.stderr}`,
      ).toBe(0);
    }
  } finally {
    stub.mockRestore();
    source.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}, 300_000);
