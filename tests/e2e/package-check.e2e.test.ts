import { afterAll, beforeAll, expect, spyOn, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { dag } from "@dagger.io/dagger";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const repo = join(import.meta.dir, "../..");
let root: string;
let generated: Map<string, string>;
const run = (cwd: string, script: string) =>
  spawnSync("bun", ["run", "--bun", script], {
    cwd,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, TMPDIR: join(root, "tmp") },
  });

beforeAll(async () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  root = mkdtempSync(join(repo, ".scratch/tmp_rovo_package_check_"));
  mkdirSync(join(root, "tmp"));
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    generated = (
      (await new DropCalf().init(
        mockDirectory(),
        "library",
        "tester",
        "package-check-fixture",
      )) as ReturnType<typeof mockDirectory>
    ).files;
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
  const tools = join(root, "tools");
  mkdirSync(tools);
  writeFileSync(join(tools, "package.json"), '{"private":true}');
  const installed = spawnSync(
    "bun",
    [
      "add",
      "--cwd",
      tools,
      "--ignore-scripts",
      `publint@${TOOL_VERSIONS.publint}`,
      `@arethetypeswrong/cli@${TOOL_VERSIONS.attw}`,
      `tsdown@${TOOL_VERSIONS.tsdown}`,
      `typescript@${TOOL_VERSIONS.typescript}`,
      "@types/node@22",
    ],
    { encoding: "utf8", timeout: 120_000 },
  );
  expect(installed.status, installed.stdout + installed.stderr).toBe(0);
}, 180_000);

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

function fixture(name: string) {
  const cwd = join(root, name);
  for (const [path, contents] of generated) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), contents);
  }
  symlinkSync(join(root, "tools/node_modules"), join(cwd, "node_modules"));
  const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
  pkg.devDependencies = {};
  pkg.main = "./dist/index.cjs";
  pkg.types = "./dist/index.d.cts";
  pkg.exports["."].import.types = "./dist/index.d.mts";
  pkg.scripts.build =
    "printf 'build\\n' >> build.log && mkdir -p dist && cp payload/* dist/";
  for (const hook of [
    "prepare",
    "prepack",
    "postpack",
    "prepublishOnly",
    "publish",
    "postpublish",
  ]) {
    pkg.scripts[hook] = "echo unexpected-lifecycle >> lifecycle.log; exit 79";
  }
  mkdirSync(join(cwd, "payload"));
  writeFileSync(join(cwd, "payload/index.mjs"), "export const answer = 42;\n");
  writeFileSync(join(cwd, "payload/index.cjs"), "exports.answer = 42;\n");
  for (const ext of ["d.mts", "d.cts"])
    writeFileSync(
      join(cwd, `payload/index.${ext}`),
      "export declare const answer: number;\n",
    );
  writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  return {
    cwd,
    pkg,
    save: () => writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg)),
  };
}

test("a build failure stops before packing or checking and retains its diagnostic", () => {
  const { cwd, pkg, save } = fixture("build-failure");
  pkg.scripts.build = "echo deliberate-build-failure >&2; exit 23";
  save();
  const result = run(cwd, "pack:check");
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("deliberate-build-failure");
  expect(result.stdout + result.stderr).not.toContain("npm notice");
  expect(result.stdout + result.stderr).not.toContain("publint");
  expect(existsSync(join(cwd, "dist"))).toBe(false);
  expect(existsSync(join(cwd, "lifecycle.log"))).toBe(false);
});

test("a pack failure retains npm diagnostics and stops before the checkers", () => {
  const { cwd, pkg, save } = fixture("pack-failure");
  pkg.scripts.build = "rm package.json";
  save();
  const result = run(cwd, "pack:check");
  expect(result.status).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("ENOENT");
  expect(result.stdout + result.stderr).not.toContain("Running publint");
});

test("checks reject declarations excluded from the tarball even when they exist locally", () => {
  const { cwd, pkg, save } = fixture("missing-packed-types");
  pkg.files = ["dist/*.mjs", "dist/*.cjs"];
  save();
  const result = run(cwd, "pack:check");
  expect(existsSync(join(cwd, "dist/index.d.mts"))).toBe(true);
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("does not exist");
  expect(
    JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).files,
  ).toEqual(["dist/*.mjs", "dist/*.cjs"]);
});

test("Publint rejects a warning in the packed declaration exports under strict mode", () => {
  const { cwd, pkg, save } = fixture("publint-failure");
  pkg.exports["."].import = {
    default: "./dist/index.mjs",
    types: "./dist/index.d.mts",
  };
  save();
  const result = run(cwd, "pack:check");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("types");
  expect(result.stdout + result.stderr).toContain("first");
  expect(result.stdout + result.stderr).not.toContain("No problems found");
  expect(
    readdirSync(join(root, "tmp")).filter((path) =>
      path.startsWith("pack-check."),
    ),
  ).toEqual([]);
});

test("Are the Types Wrong rejects declarations advertising a nonexistent default export", () => {
  const { cwd } = fixture("attw-failure");
  writeFileSync(
    join(cwd, "payload/index.d.cts"),
    "declare const value: number; export default value;\n",
  );
  const result = run(cwd, "pack:check");
  expect(result.status, result.stdout + result.stderr).not.toBe(0);
  expect(result.stdout + result.stderr).toContain("node10");
  expect(result.stdout + result.stderr).toContain("ESM");
  expect(
    readdirSync(join(root, "tmp")).filter((path) =>
      path.startsWith("pack-check."),
    ),
  ).toEqual([]);
});

test.each([
  { name: "explicit-js", specifier: "./answer.js", status: 0 },
  { name: "extensionless-blocker", specifier: "./answer", status: 1 },
])(
  "default build declaration compatibility: $name",
  ({ name, specifier, status }) => {
    const { cwd, pkg, save } = fixture(name);
    const original = JSON.parse(generated.get("package.json") ?? "{}");
    for (const field of ["main", "types", "exports"])
      pkg[field] = original[field];
    pkg.scripts.build = original.scripts.build;
    save();
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src/index.ts"),
      `export { answer } from '${specifier}';\n`,
    );
    writeFileSync(
      join(cwd, "src/answer.ts"),
      "export const answer: number = 42;\n",
    );
    const result = run(cwd, "pack:check");
    expect(result.status, result.stdout + result.stderr).toBe(status);
    if (status !== 0) {
      expect(result.stdout + result.stderr).toContain(
        "Internal resolution error",
      );
      expect(result.stdout + result.stderr).toContain("node16 (from ESM)");
      expect(readFileSync(join(cwd, "dist/index.d.ts"), "utf8")).toContain(
        "'./answer'",
      );
    }
  },
  90_000,
);

test("pack:check builds once, checks a strict consumer package without running lifecycle hooks, and cleans its tarball", () => {
  const { cwd } = fixture("valid");
  const result = run(cwd, "pack:check");
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(result.stdout + result.stderr).toContain("index.d.mts");
  expect(result.stdout + result.stderr).toContain("publint");
  expect(result.stdout + result.stderr).toContain("No problems found");
  expect(readFileSync(join(cwd, "build.log"), "utf8")).toBe("build\n");
  expect(existsSync(join(cwd, "lifecycle.log"))).toBe(false);
  expect(readdirSync(cwd).some((path) => path.endsWith(".tgz"))).toBe(false);
  expect(
    readdirSync(join(root, "tmp")).filter((path) =>
      path.startsWith("pack-check."),
    ),
  ).toEqual([]);
}, 90_000);
