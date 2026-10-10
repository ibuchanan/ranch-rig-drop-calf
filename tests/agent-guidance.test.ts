import { expect, test } from "bun:test";
import { DropCalf } from "../src/index.ts";
import { applyPreclean } from "../src/preclean.ts";
import { buildProject, InvalidOptionsError } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";
import { mockOssSource } from "./oss-source.ts";

test("Forge generation includes authored agent guidance for Forge work", () => {
  const guidance = buildProject("forge-app", "sample", "tester").files.get(
    "AGENTS.md",
  );
  expect(guidance).toContain("manifest.yml");
  expect(guidance).toContain("Forge");
  expect(guidance).toContain("npm run typecheck");
});

test("excluding aidev prevents Forge guidance generation and sync seeding", () => {
  const without = ["aidev"];
  expect(
    buildProject(
      "forge-app",
      "sample",
      "tester",
      "",
      "",
      [],
      without,
    ).files.has("AGENTS.md"),
  ).toBe(false);
  const original = new Map([["package.json", '{"name":"sample"}']]);
  const plan = planSync(
    original,
    "forge-app",
    "tester",
    undefined,
    [],
    without,
  );
  expect(
    plan.operations.some((operation) => operation.path === "AGENTS.md"),
  ).toBe(false);
  const result = applySync(plan).files;
  expect(result.has("AGENTS.md")).toBe(false);
  expect(
    planSync(result, "forge-app", "tester", undefined, [], without).operations,
  ).toEqual([]);
  expect(() =>
    buildProject("forge-app", "sample", "tester", "", "", ["aidev"], without),
  ).toThrow(InvalidOptionsError);
  expect(() =>
    buildProject("library", "sample", "tester", "", "", [], without),
  ).toThrow(InvalidOptionsError);
});

test("non-Forge kinds omit Forge-specific guidance", () => {
  for (const kind of ["library", "tool", "agent-skill"])
    expect(buildProject(kind, "sample", "tester").files.has("AGENTS.md")).toBe(
      false,
    );
});

test("explicit Forge preclean removes scaffold guidance before authored guidance is seeded", async () => {
  const scaffold = new Map([
    [
      "manifest.yml",
      "app:\n  id: ari:cloud:ecosystem::app/example\nmodules:\n  function: []\n",
    ],
    [
      "package.json",
      '{"name":"example","scripts":{"lint":"eslint ."},"dependencies":{"@forge/api":"^7.0.0"}}',
    ],
    ["AGENTS.md", "# Forge starter guidance\n"],
  ]);
  const directory = (files: Map<string, string>) => ({
    files,
    exists: async (path: string) => files.has(path),
    withoutFile: (path: string) => {
      const next = new Map(files);
      next.delete(path);
      return directory(next);
    },
  });
  const cleaned = (
    (await applyPreclean(directory(scaffold) as never)) as unknown as {
      files: Map<string, string>;
    }
  ).files;
  expect(cleaned.has("AGENTS.md")).toBe(false);
  cleaned.set(
    "package.json",
    JSON.stringify(buildProject("forge-app", "example", "tester").packageJson),
  );
  const result = applySync(planSync(cleaned, "forge-app", "tester")).files;
  expect(result.get("AGENTS.md")).toBe(
    buildProject("forge-app", "example", "tester").files.get("AGENTS.md"),
  );
});

test("routine sync seeds missing guidance and repeats without changing it", () => {
  const original = new Map([["package.json", '{"name":"sample"}']]);
  const plan = planSync(original, "forge-app", "tester");
  expect(plan.operations).toContainEqual(
    expect.objectContaining({
      path: "AGENTS.md",
      key: "seed",
      mode: "create-if-absent",
    }),
  );
  const result = applySync(plan).files;
  expect(result.get("AGENTS.md")).toBe(
    buildProject("forge-app", "sample", "tester").files.get("AGENTS.md"),
  );
  expect(planSync(result, "forge-app", "tester").operations).toEqual([]);
});

test("routine sync reports edited guidance as a conflict without changing it", async () => {
  const original = new Map([
    ["package.json", '{"name":"sample"}'],
    ["AGENTS.md", "# Our local instructions\n"],
  ]);
  expect(() => planSync(original, "forge-app", "tester")).toThrow(
    ConflictError,
  );
  expect(() => planSync(original, "forge-app", "tester")).toThrow(/AGENTS\.md/);
  const writes: string[] = [];
  const directory = {
    exists: async (path: string) => original.has(path),
    file: (path: string) => ({ contents: async () => original.get(path) }),
    withNewFile: (path: string) => {
      writes.push(path);
      return directory;
    },
  };
  const module = mockOssSource();
  try {
    await expect(
      new DropCalf().previewSync(directory as never, "forge-app", "tester"),
    ).rejects.toThrow(/AGENTS\.md/);
    await expect(
      new DropCalf().sync(directory as never, "forge-app", "tester"),
    ).rejects.toThrow(/AGENTS\.md/);
    expect(writes).toEqual([]);
  } finally {
    module.mockRestore();
  }
  expect(original.get("AGENTS.md")).toBe("# Our local instructions\n");
});
