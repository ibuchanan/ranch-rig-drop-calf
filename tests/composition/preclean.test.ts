import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { applyPreclean, UNWANTED } from "../../src/composition/scaffold.ts";
import {
  EMPTY_SECTIONS,
  SCAFFOLD_FIELDS,
  stripScaffold,
} from "../../src/core/package-json.ts";

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
    main: "index.js",
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

  test("strips main when it is the only remaining scaffold field", () => {
    const input = JSON.stringify({
      main: "index.js",
      scripts: {},
      devDependencies: {},
    });
    expect(stripScaffold(input)).toBe(CLEAN);
    expect(stripScaffold(stripScaffold(input))).toBe(CLEAN);
  });

  test("preserves owner fields and is byte-idempotent across scaffold packages", () => {
    const entries = fc.dictionary(
      fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
      fc.string(),
      { maxKeys: 8 },
    );
    const packages = fc.record(
      {
        name: fc.string(),
        version: fc.string(),
        description: fc.string(),
        license: fc.string(),
        main: fc.string(),
        scripts: entries,
        devDependencies: entries,
        dependencies: entries,
        private: fc.boolean(),
        "x-owner": fc.jsonValue(),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(packages, fc.integer({ min: 0, max: 8 }), (pkg, indent) => {
        const input = JSON.stringify(pkg, null, indent);
        const cleaned = stripScaffold(input);
        const expected = {
          ...JSON.parse(input),
          scripts: {},
          devDependencies: {},
        };
        for (const field of SCAFFOLD_FIELDS) delete expected[field];
        expect(JSON.parse(cleaned)).toEqual(expected);
        expect(stripScaffold(cleaned)).toBe(cleaned);
      }),
    );
  });

  test("returns the input untouched when there is nothing to strip", () => {
    expect(stripScaffold(CLEAN)).toBe(CLEAN);
    expect(stripScaffold(scaffolded)).not.toBe(scaffolded);
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
    const result = await applyPreclean(source as never);
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
    const result = await applyPreclean(source as never);
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
    expect((await applyPreclean(source as never)) as unknown).toBe(source);
    expect(removed).toEqual([]);
    expect(written).toEqual([]);
  });

  test("skips the rewrite when package.json is absent", async () => {
    const withoutPackage = new Map(preserved);
    withoutPackage.delete("package.json");
    const { source, written } = directory(withoutPackage);
    await applyPreclean(source as never);
    expect(written).toEqual([]);
  });
});
