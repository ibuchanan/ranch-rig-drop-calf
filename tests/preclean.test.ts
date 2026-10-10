import { describe, expect, test } from "bun:test";
import { DropCalf } from "../src/index.ts";
import {
  applyPreclean,
  EMPTY_SECTIONS,
  SCAFFOLD_FIELDS,
  stripScaffold,
  UNWANTED,
} from "../src/preclean.ts";

function directory(files: Map<string, string>) {
  const removed: string[] = [];
  const written: [string, string][] = [];
  const make = (contents: Map<string, string>) => ({
    exists: async (path: string) => contents.has(path),
    withoutFile: (path: string) => {
      removed.push(path);
      const next = new Map(contents);
      next.delete(path);
      return make(next);
    },
    file: (path: string) => ({
      contents: async () => {
        const found = contents.get(path);
        if (found === undefined) throw new Error(`no such file ${path}`);
        return found;
      },
    }),
    withNewFile: (path: string, text: string) => {
      written.push([path, text]);
      const next = new Map(contents);
      next.set(path, text);
      return make(next);
    },
    changes: (before: unknown) => ({
      before,
      removed: [...removed],
      written: [...written],
    }),
    entries: () => [...contents],
  });
  return { source: make(files), removed, written };
}

// Already stripped and normalized: preclean must leave this byte-identical.
const CLEAN = `${JSON.stringify({ scripts: {}, devDependencies: {} }, null, 2)}\n`;

const preserved = new Map([
  ["manifest.yml", "app: ..."],
  ["package.json", CLEAN],
  ["src/index.ts", "app source"],
]);
const starter = new Map([
  ...preserved,
  ...UNWANTED.map((path) => [path, `starter ${path}`] as const),
]);

const scaffolded = JSON.stringify(
  {
    version: "1.0.0",
    name: "forge-scaffold",
    private: true,
    license: "MIT",
    description: "Forge app",
    scripts: { start: "dagger develop" },
    devDependencies: { "@types/node": "^22.0.0" },
    dependencies: { yaml: "^2.9.1" },
  },
  null,
  2,
);

describe("stripScaffold", () => {
  test("drops forge create metadata and empties regenerated sections", () => {
    const result = JSON.parse(stripScaffold(scaffolded));
    for (const field of SCAFFOLD_FIELDS)
      expect(Object.hasOwn(result, field)).toBe(false);
    for (const section of EMPTY_SECTIONS) expect(result[section]).toEqual({});
  });

  test("keeps fields Drop Calf does not own", () => {
    const result = JSON.parse(stripScaffold(scaffolded));
    expect(result).toMatchObject({
      private: true,
      dependencies: { yaml: "^2.9.1" },
    });
  });

  test("returns the input untouched when there is nothing to strip", () => {
    expect(stripScaffold(CLEAN)).toBe(CLEAN);
    expect(stripScaffold(scaffolded)).not.toBe(scaffolded);
  });

  test("is idempotent: a second pass is a no-op", () => {
    const once = stripScaffold(scaffolded);
    expect(stripScaffold(once)).toBe(once);
  });

  test("normalizes formatting when it rewrites", () => {
    const result = stripScaffold('{"name":"forge-scaffold","scripts":{}}');
    expect(result).toBe(
      `${JSON.stringify({ scripts: {}, devDependencies: {} }, null, 2)}\n`,
    );
  });

  test("sorts keys into canonical order when it rewrites", () => {
    const result = stripScaffold(
      '{"engines":{"node":">=22"},"devDependencies":{},"name":"forge-scaffold","type":"module","scripts":{},"private":true}',
    );
    expect(Object.keys(JSON.parse(result))).toEqual([
      "private",
      "type",
      "scripts",
      "devDependencies",
      "engines",
    ]);
  });

  test("leaves an unsorted but already-stripped file unsorted", () => {
    // No-op safety is about content, so a file that only differs by key order
    // is left for sort-package-json's own pre-commit hook, not rewritten here.
    const unsorted = '{"devDependencies":{},"scripts":{},"private":true}';
    expect(stripScaffold(unsorted)).toBe(unsorted);
  });

  test("adds the emptied sections when the scaffold omits them", () => {
    const result = JSON.parse(stripScaffold('{"private":true}'));
    expect(result).toEqual({ scripts: {}, devDependencies: {}, private: true });
  });

  test("reports malformed package.json as a contextual parse error", () => {
    expect(() => stripScaffold("{")).toThrow(/cannot parse package\.json/);
    expect(() => stripScaffold("[]")).toThrow(/cannot parse package\.json/);
  });
});

describe("Forge bootstrap preclean", () => {
  test("deletes only present unwanted files through Dagger without changing the input", async () => {
    const { source, removed, written } = directory(starter);
    const result = await new DropCalf().removeScaffold(source as never);
    expect(removed).toEqual([...UNWANTED]);
    expect(written).toEqual([]);
    expect((result as unknown as typeof source).entries()).toEqual([
      ...preserved,
    ]);
    expect(source.entries()).toEqual([...starter]);
    expect((await applyPreclean(result)) as unknown).toBe(result);
  });

  test("rewrites package.json in place and leaves the source directory alone", async () => {
    const withScaffold = new Map([...starter, ["package.json", scaffolded]]);
    const { source, written } = directory(withScaffold);
    const result = await new DropCalf().removeScaffold(source as never);
    const cleaned = stripScaffold(scaffolded);
    expect(written).toEqual([["package.json", cleaned]]);
    expect((result as unknown as typeof source).entries()).toContainEqual([
      "package.json",
      cleaned,
    ]);
    expect(source.entries()).toEqual([...withScaffold]);
  });

  test("skips absent unwanted files and preserves an unchanged directory", async () => {
    const { source, removed, written } = directory(new Map(preserved));
    expect(
      (await new DropCalf().removeScaffold(source as never)) as unknown,
    ).toBe(source);
    expect(removed).toEqual([]);
    expect(written).toEqual([]);
  });

  test("skips the rewrite when package.json is absent", async () => {
    const withoutPackage = new Map(preserved);
    withoutPackage.delete("package.json");
    const { source, written } = directory(withoutPackage);
    await new DropCalf().removeScaffold(source as never);
    expect(written).toEqual([]);
  });

  test("removeScaffoldChanges compares the cleaned snapshot to the original", async () => {
    const { source, removed } = directory(starter);
    expect(
      (await new DropCalf().removeScaffoldChanges(source as never)) as unknown,
    ).toEqual({ before: source, removed: [...UNWANTED], written: [] });
    expect(removed).toEqual([...UNWANTED]);
  });
});
