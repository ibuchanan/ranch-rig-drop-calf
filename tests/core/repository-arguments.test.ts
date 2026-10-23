import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  daggerArguments,
  OPERATIONS,
} from "../../scripts/repository/request.ts";

type Request = Parameters<typeof daggerArguments>[0];

const workspace = {
  directory: "/work",
  snapshot: "/tmp/run/input",
  history: "/tmp/run/input.bundle",
  branch: "main",
};

function operation(name: "init" | "update") {
  const spec = OPERATIONS.get(name);
  if (!spec) throw new Error(`missing operation ${name}`);
  return { operation: name, spec };
}

const request = (
  name: "init" | "update",
  values: Record<string, unknown>,
  directory = "/work",
): Request => ({
  ...operation(name),
  values: values as Request["values"],
  directory,
  original: {},
  branch: "main",
  identity: { name: "Ada", email: "ada@example.com" },
});

const build = (r: Request, baseline: string[] = []) =>
  daggerArguments(r, workspace, "/module", baseline, "/tmp/run/output");

test("init forwards owner, name, description, preset, and repeated function flags in order", () => {
  expect(
    build(
      request("init", {
        profile: "tool",
        owner: "ada",
        "package-name": "named",
        description: "A tool",
        preset: "all",
        "with-functions": ["evals", "fallow"],
        "without-functions": ["aidev"],
      }),
      ["--history", workspace.history],
    ),
  ).toEqual([
    "-m",
    "/module",
    "call",
    "init",
    "--directory",
    "/tmp/run/input",
    "--profile",
    "tool",
    "--git",
    "--target-branch",
    "main",
    "--author-name",
    "Ada",
    "--author-email",
    "ada@example.com",
    "--history",
    "/tmp/run/input.bundle",
    "--owner",
    "ada",
    "--package-name",
    "named",
    "--description",
    "A tool",
    "--preset",
    "all",
    "--with-functions",
    "evals",
    "--with-functions",
    "fallow",
    "--without-functions",
    "aidev",
    "export",
    "--path",
    "/tmp/run/output",
  ]);
});

test("init derives a package name from the scaffold package.json, else the directory", () => {
  const root = mkdtempSync(join(tmpdir(), "repository-args-"));
  try {
    const directory = join(root, "dir-name");
    mkdirSync(directory);
    const values = { profile: "tool", owner: "ada" };
    expect(build(request("init", values, directory))).toContain("dir-name");
    writeFileSync(join(directory, "package.json"), '{"name":"from-manifest"}');
    const args = build(request("init", values, directory));
    expect(args).toContain("from-manifest");
    expect(args).not.toContain("dir-name");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("update forwards only the preset and never seeds a package name", () => {
  const args = build(
    request("update", {
      profile: "tool",
      owner: "ignored",
      description: "ignored",
      "package-name": "ignored",
      preset: "all",
    }),
  );
  expect(args).toContain("--preset");
  for (const flag of ["--owner", "--description", "--package-name"])
    expect(args).not.toContain(flag);
});

test("operations declare what they require", () => {
  expect(OPERATIONS.get("init")?.required).toEqual(["profile", "owner"]);
  expect(OPERATIONS.get("update")?.requiresCommit).toBe(true);
  expect(OPERATIONS.has("delete")).toBe(false);
});
