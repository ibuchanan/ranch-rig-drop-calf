import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { validateChangelog } from "../src/changelog.ts";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";

test("changelog kinds generate a pinned command and authored release policy", () => {
  for (const kind of ["library", "forge-app", "tool"]) {
    const project = buildProject(kind, "sample", "", "none");
    expect(project.packageJson.devDependencies["git-cliff"]).toBe(
      TOOL_VERSIONS.gitCliff,
    );
    expect(project.packageJson.scripts.changelog).toBe(
      "git cliff --config cliff.toml --unreleased",
    );
    expect(project.files.get("cliff.toml")).toContain(
      "conventional_commits = true",
    );
    expect(project.files.get("cliff.toml")).toContain('message = "^feat"');
  }
  const skill = buildProject("agent-skill", "sample", "", "none");
  expect(skill.packageJson.scripts.changelog).toBeUndefined();
  expect(skill.packageJson.devDependencies["git-cliff"]).toBeUndefined();
  expect(skill.files.has("cliff.toml")).toBe(false);
});

test("sync seeds release policy and converges without changing custom policy", () => {
  const files = new Map([["package.json", '{"name":"sample"}']]);
  const first = applySync(planSync(files, "tool")).files;
  expect(first.get("cliff.toml")).toBe(
    buildProject("tool", "sample", "", "none").files.get("cliff.toml"),
  );
  expect(planSync(first, "tool").operations).toEqual([]);

  const custom = "# team's own release policy\n[changelog]\nbody = 'custom'\n";
  const customized = new Map(first);
  customized.set("cliff.toml", custom);
  expect(planSync(customized, "tool").operations).toEqual([]);
  expect(applySync(planSync(customized, "tool")).files.get("cliff.toml")).toBe(
    custom,
  );
});

test("sync rejects a conflicting changelog command without mutating files", () => {
  const original = '{"name":"sample","scripts":{"changelog":"release-it"}}';
  const files = new Map([["package.json", original]]);
  expect(() => planSync(files, "tool")).toThrow(ConflictError);
  expect(files.get("package.json")).toBe(original);
  expect(files.has("cliff.toml")).toBe(false);
});

test("validation explicitly skips without config, history, or local tool", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_cliff_"));
  try {
    expect(validateChangelog(root)).toEqual({
      status: "skipped",
      reason: "cliff.toml is missing",
    });
    writeFileSync(
      join(root, "cliff.toml"),
      buildProject("tool", "sample").files.get("cliff.toml") ?? "",
    );
    expect(validateChangelog(root)).toEqual({
      status: "skipped",
      reason: "Git history is unavailable",
    });
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, "README.md"), "sample\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "feat: initial",
        "--no-gpg-sign",
      ],
      { cwd: root },
    );
    expect(validateChangelog(root)).toEqual({
      status: "skipped",
      reason: "git-cliff is not installed locally",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("validation invokes the local git-cliff against history and reports failures", async () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_cliff_"));
  try {
    mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
    writeFileSync(
      join(root, "cliff.toml"),
      buildProject("tool", "sample").files.get("cliff.toml") ?? "",
    );
    execFileSync("git", ["init", "-q", root]);
    writeFileSync(join(root, "README.md"), "sample\n");
    execFileSync("git", ["add", "README.md"], { cwd: root });
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-qm",
        "feat: initial",
        "--no-gpg-sign",
      ],
      { cwd: root },
    );
    const binary = join(root, "node_modules", ".bin", "git-cliff");
    writeFileSync(binary, '#!/bin/sh\nprintf "%s" "$*" > validated-args\n');
    chmodSync(binary, 0o755);
    expect(validateChangelog(root)).toEqual({ status: "validated" });
    expect(validateChangelog(root.slice(process.cwd().length + 1))).toEqual({
      status: "validated",
    });
    expect(await Bun.file(join(root, "validated-args")).text()).toBe(
      "--config cliff.toml --unreleased",
    );
    writeFileSync(binary, "#!/bin/sh\nexit 2\n");
    expect(() => validateChangelog(root)).toThrow(
      /git-cliff validation failed/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
