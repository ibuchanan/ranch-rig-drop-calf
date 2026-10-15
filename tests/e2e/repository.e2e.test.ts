import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { git } from "../../src/repository-git.ts";

const module = join(import.meta.dir, "../..");

test("local launcher runs containerized init and update and delivers their commit graph", () => {
  mkdirSync(join(module, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(module, ".scratch/tmp_rovo_repository_e2e_"));
  const source = join(root, "project");
  mkdirSync(source);
  const launch = (operation: string) =>
    execFileSync(
      "bun",
      [
        "run",
        "scripts/repository.ts",
        operation,
        "--directory",
        source,
        "--profile",
        "tool",
        ...(operation === "init" ? ["--owner", "tester"] : []),
        "--author-name",
        "Test",
        "--author-email",
        "test@example.com",
      ],
      {
        cwd: module,
        encoding: "utf8",
        timeout: 240_000,
        stdio: "pipe",
        env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
      },
    );
  try {
    writeFileSync(join(source, "README.md"), "scaffold readme");
    writeFileSync(
      join(source, "package.json"),
      '{"name":"sample","dependencies":{"yaml":"2.9.1"}}\n',
    );
    writeFileSync(join(source, ".gitignore"), ".env\nnode_modules\n");
    writeFileSync(join(source, ".env"), "IGNORED=secret\n");
    expect(launch("init")).toContain("initialized:");
    expect(git(source, "rev-list", "--count", "HEAD")).toBe("2");
    expect(git(source, "status", "--porcelain")).toBe("");
    expect(readFileSync(join(source, ".env"), "utf8")).toBe("IGNORED=secret\n");
    expect(existsSync(join(source, "catalog-info.yaml"))).toBe(true);
    expect(
      JSON.parse(readFileSync(join(source, "package.json"), "utf8")).name,
    ).toBe("sample");
    git(source, "config", "user.name", "Test");
    git(source, "config", "user.email", "test@example.com");
    const pkg = JSON.parse(readFileSync(join(source, "package.json"), "utf8"));
    pkg.devDependencies.typescript = "0.0.1";
    writeFileSync(
      join(source, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`,
    );
    git(source, "add", "package.json");
    git(source, "commit", "-m", "chore: simulate outdated tooling");
    const base = git(source, "rev-parse", "HEAD");
    expect(launch("update")).toContain("updated:");
    const parents = git(source, "show", "-s", "--format=%P", "HEAD").split(" ");
    expect(parents).toHaveLength(2);
    expect(parents[0]).toBe(base);
    expect(git(source, "branch", "--list", "drop-calf/update/*")).toContain(
      "drop-calf/update/",
    );
    expect(git(source, "status", "--porcelain")).toBe("");
    const head = git(source, "rev-parse", "HEAD");
    expect(launch("update")).toContain("unchanged:");
    expect(git(source, "rev-parse", "HEAD")).toBe(head);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 600_000);
