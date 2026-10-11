import { expect, test } from "bun:test";
import { applyPreclean } from "../src/preclean.ts";
import { buildProject, InvalidOptionsError } from "../src/profiles.ts";

test("Forge generation includes authored agent guidance for Forge work", () => {
  const guidance = buildProject("forge-app", "sample", "tester").files.get(
    "AGENTS.md",
  );
  expect(guidance).toContain("manifest.yml");
  expect(guidance).toContain("Forge");
  expect(guidance).toContain("npm run typecheck");
});

test("authored guidance stays inside the line length lint:docs enforces", () => {
  // `lint:docs` globs `**/*.md`, so this Markdown is linted too and has to
  // survive MD013 without being a seeded file the docs tree can wrap.
  const guidance = buildProject("forge-app", "sample", "tester").files.get(
    "AGENTS.md",
  ) as string;
  expect(
    guidance
      .split("\n")
      .map((line, index) => [index + 1, line.length] as const)
      .filter(([, length]) => length > 80),
  ).toEqual([]);
});

test("excluding aidev prevents Forge guidance generation", () => {
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

test("explicit Forge preclean removes scaffold guidance so generated guidance can replace it", async () => {
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
    file: (path: string) => ({
      contents: async () => files.get(path) as string,
    }),
    withNewFile: (path: string, contents: string) => {
      const next = new Map(files);
      next.set(path, contents);
      return directory(next);
    },
  });
  const cleaned = (
    (await applyPreclean(directory(scaffold) as never)) as unknown as {
      files: Map<string, string>;
    }
  ).files;
  expect(cleaned.has("AGENTS.md")).toBe(false);
});
