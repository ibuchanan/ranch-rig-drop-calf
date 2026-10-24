import { expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import {
  CHECK_COMMAND,
  LINT_COMMAND,
  lint,
} from "../../src/capabilities/lint.ts";
import {
  blueprintFor,
  buildProject,
  PROFILES,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { updateCapabilities } from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { isBunKind } from "../support/kinds.ts";
import { mockDirectory } from "../support/module-source.ts";

const root = resolve(import.meta.dir, "../..");
const members = (scripts: Record<string, string>) =>
  Object.keys(scripts)
    .filter((name) => /^lint:check:[^:]+$/.test(name))
    .sort();

for (const kind of Object.keys(PROFILES)) {
  test(`${kind} owns lint/check independently of hook selection or composition order`, async () => {
    const capabilities = resolveProfile(kind).filter(
      (item) => item.name !== "git-hooks",
    );
    const forward = blueprintFor(capabilities, "sample", "tester");
    const reversed = blueprintFor(
      [...capabilities].reverse(),
      "sample",
      "tester",
    );
    expect(forward.packageJson.scripts.lint).toBe(
      isBunKind(kind)
        ? LINT_COMMAND.replace("--npm-path npm", "--npm-path bun")
        : LINT_COMMAND,
    );
    expect(forward.packageJson.scripts.check).toBe(
      isBunKind(kind)
        ? CHECK_COMMAND.replace("--npm-path npm", "--npm-path bun")
        : CHECK_COMMAND,
    );
    expect(reversed.packageJson.scripts).toEqual(forward.packageJson.scripts);
    expect(forward.packageJson.devDependencies["npm-run-all2"]).toBe(
      TOOL_VERSIONS.npmRunAll2,
    );
    const scripts = forward.packageJson.scripts;
    expect(scripts["lint:check:biome"]).toBe("biome lint");
    for (const name of [
      "lint:check",
      "lint:biome",
      "lint:fallow",
      "lint:forge",
      "lint:prelint",
    ])
      expect(scripts[name]).toBeUndefined();
    expect(members(scripts)).toEqual(
      [
        "lint:check:biome",
        ...(kind === "library" || kind === "tool" ? ["lint:check:fallow"] : []),
        ...(kind === "agent-skill" ? ["lint:check:skills"] : []),
        "lint:check:format",
        ...(kind === "forge-app"
          ? ["lint:check:forge", "lint:check:prelint"]
          : []),
        "lint:check:typecheck",
      ].sort(),
    );
  });
}

test.each(["library", "tool"])(
  "%s without Fallow has no Fallow lint member",
  (kind) => {
    const project = buildProject(kind, "sample", "tester", "", [], ["fallow"]);
    expect(project.packageJson.scripts["lint:check:fallow"]).toBeUndefined();
    expect(project.packageJson.scripts["lint:fallow"]).toBeUndefined();
  },
);

test("lint updates its own aggregate and preserves owner scripts idempotently", async () => {
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          scripts: {
            lint: "lefthook run lint",
            "lint:check:owner": "echo owner",
            custom: "echo custom",
          },
        }),
      ],
    ]),
  );
  const output = await updateCapabilities(input, [lint()]);
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg.scripts).toEqual({
    lint: LINT_COMMAND,
    check: CHECK_COMMAND,
    "lint:check:owner": "echo owner",
    custom: "echo custom",
  });
  expect(await updateCapabilities(output, [lint()])).toBe(output);
});

async function runLint(scripts: Record<string, string>, workflow = "lint") {
  const scratch = join(root, ".scratch");
  mkdirSync(scratch, { recursive: true });
  const directory = mkdtempSync(join(scratch, "tmp_rovo_lint with spaces-"));
  try {
    writeFileSync(join(directory, "package.json"), JSON.stringify({ scripts }));
    expect(existsSync(join(directory, ".git"))).toBe(false);
    const env = {
      ...process.env,
      GIT_CEILING_DIRECTORIES: scratch,
      PATH: `${join(root, "node_modules/.bin")}:${process.env.PATH}`,
    };
    expect(
      Bun.spawnSync(["git", "rev-parse", "--is-inside-work-tree"], {
        cwd: directory,
        env,
      }).exitCode,
    ).not.toBe(0);
    const child = Bun.spawn([process.execPath, "run", workflow], {
      cwd: directory,
      env,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { output: stdout + stderr, code };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test.each(["forge-app", "tool"])(
  "%s real runner discovers a new producer, labels output, and excludes leaf, docs, and fix scripts without Git",
  async (kind) => {
    const { packageJson } = buildProject(kind, "sample", "tester");
    const scripts = { ...packageJson.scripts };
    for (const name of members(scripts)) {
      scripts[name] = `printf '${name}-ran\\n'`;
    }
    scripts["lint:check:new-producer"] = "printf 'new-producer-ran\\n'";
    scripts["lint:check"] = "exit 30";
    scripts["lint:docs"] = "exit 31";
    scripts["lint:fix"] = "exit 32";
    scripts["lint:check:biome:watch"] = "exit 33";
    const result = await runLint(scripts);
    expect(result.code).toBe(0);
    for (const name of members(scripts))
      expect(result.output).toContain(`[${name}`);
    expect(result.output).toContain("new-producer-ran");
    expect(result.output.match(/\]\s+lint:check:biome-ran\r?\n/g)).toHaveLength(
      1,
    );
    expect(result.output).not.toContain("Task not found");
  },
  20_000,
);

test("real runner propagates failures and aborts an unfinished sibling", async () => {
  const result = await runLint({
    lint: LINT_COMMAND,
    "lint:check:failure": "sleep 1; echo failure-output; exit 7",
    "lint:check:slow": "sleep 30; echo should-not-finish",
  });
  expect(result.code).toBe(1);
  expect(result.output).toContain("[lint:check:failure]");
  expect(result.output).toContain("exited with 7");
  expect(result.output).not.toMatch(/\]\s+should-not-finish\r?\n/);
}, 20_000);

test("real runner permits an unmatched family without running unrelated scripts", async () => {
  const result = await runLint({
    lint: LINT_COMMAND,
    "lint:checks:typo": "echo should-not-run; exit 23",
  });
  expect(result.code).toBe(0);
  expect(result.output).not.toContain("should-not-run");
});

test("real runner rejects a missing literal task", async () => {
  const result = await runLint({
    lint: LINT_COMMAND.replace("lint:check:*", "lint:check:missing"),
    "lint:check:owner": "echo should-not-run; exit 23",
  });
  expect(result.code).not.toBe(0);
  expect(result.output).toContain("Task not found");
  expect(result.output).not.toContain("should-not-run");
});

test.each(Object.keys(PROFILES))(
  "%s check runs exactly the available verification scripts once without Git",
  async (kind) => {
    const { scripts: generated } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    const scripts: Record<string, string> = { ...generated };
    const tasks = ["lint", "test", "size:check", "pack:check"];
    for (const name of tasks) {
      if (generated[name]) scripts[name] = `echo ${name}-ran`;
    }
    for (const name of [
      "lint:fix",
      "lint:docs",
      "test:watch",
      "test:coverage",
      "size:check:watch",
      "pack:check:watch",
      "release:check",
    ]) {
      scripts[name] = "echo unrelated-script-ran; exit 23";
    }
    const result = await runLint(scripts, "check");
    expect(result.code).toBe(0);
    for (const name of tasks) {
      const occurrences =
        result.output.match(new RegExp(`\\]\\s+${name}-ran\\r?\\n`, "g")) ?? [];
      expect(occurrences).toHaveLength(generated[name] ? 1 : 0);
    }
    expect(result.output).not.toMatch(/\]\s+unrelated-script-ran/);
  },
  20_000,
);

test("check includes optional scripts added by the owner", async () => {
  const result = await runLint(
    {
      check: CHECK_COMMAND,
      lint: "echo lint-ran",
      test: "echo test-ran",
      "size:check": "echo size-ran",
      "pack:check": "echo pack-ran",
    },
    "check",
  );
  expect(result.code).toBe(0);
  for (const label of ["lint", "test", "size:check", "pack:check"])
    expect(result.output).toContain(`[${label}`);
  expect(result.output).toContain("size-ran");
  expect(result.output).toContain("pack-ran");
});

test("check propagates a failure and aborts an unfinished sibling", async () => {
  const result = await runLint(
    {
      check: CHECK_COMMAND,
      lint: "sleep 1; echo failure-output; exit 7",
      test: "sleep 30; echo should-not-finish",
    },
    "check",
  );
  expect(result.code).toBe(1);
  expect(result.output).toContain("exited with 7");
  expect(result.output).not.toMatch(/\]\s+should-not-finish\r?\n/);
}, 20_000);

test("test runner version matches the generated pin", () => {
  expect(
    JSON.parse(
      readFileSync(
        join(root, "node_modules/npm-run-all2/package.json"),
        "utf8",
      ),
    ).version,
  ).toBe(TOOL_VERSIONS.npmRunAll2);
});
