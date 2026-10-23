import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { applyPreclean } from "../../src/composition/scaffold.ts";
import { stripScaffold } from "../../src/core/package-json.ts";
import { contents } from "../support/capability-fixtures.ts";
import { mockDirectory } from "../support/module-source.ts";

// Already stripped and normalized: preclean must leave this byte-identical.
const CLEAN = `${JSON.stringify({ scripts: {}, devDependencies: {} }, null, 2)}\n`;

const preserved = new Map([
  ["manifest.yml", "app: ..."],
  ["package.json", CLEAN],
  ["src/index.ts", "app source"],
]);
const starter = new Map([
  ...preserved,
  ...[
    "AGENTS.md",
    ".eslintrc",
    "README.md",
    "package-lock.json",
    "yarn.lock",
    "tsconfig.json",
  ].map((path) => [path, `starter ${path}`] as const),
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
    expect(JSON.parse(stripScaffold(scaffolded))).toEqual({
      private: true,
      dependencies: { yaml: "^2.9.1" },
      scripts: {},
      devDependencies: {},
    });
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
        const {
          name: _name,
          version: _version,
          description: _description,
          license: _license,
          main: _main,
          ...owner
        } = JSON.parse(input);
        expect(JSON.parse(cleaned)).toEqual({
          ...owner,
          scripts: {},
          devDependencies: {},
        });
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
  test("deletes only unwanted files without changing the input", async () => {
    const source = mockDirectory(starter);
    const before = contents(source);
    const result = await applyPreclean(source);
    expect(contents(result)).toEqual(contents(mockDirectory(preserved)));
    expect(contents(source)).toEqual(before);
    expect(await applyPreclean(result)).toBe(result);
  });

  test("rewrites package.json in place and leaves the source directory alone", async () => {
    const source = mockDirectory(
      new Map([...starter, ["package.json", scaffolded]]),
    );
    const before = contents(source);
    const result = await applyPreclean(source);
    const expected = new Map(preserved).set(
      "package.json",
      stripScaffold(scaffolded),
    );
    expect(contents(result)).toEqual(contents(mockDirectory(expected)));
    expect(contents(source)).toEqual(before);
  });

  test("skips absent unwanted files and preserves an unchanged directory", async () => {
    const source = mockDirectory(preserved);
    const before = contents(source);
    expect(await applyPreclean(source)).toBe(source);
    expect(contents(source)).toEqual(before);
  });

  test("skips the rewrite when package.json is absent", async () => {
    const withoutPackage = new Map(preserved);
    withoutPackage.delete("package.json");
    const source = mockDirectory(withoutPackage);
    const before = contents(source);
    expect(await applyPreclean(source)).toBe(source);
    expect(contents(source)).toEqual(before);
  });
});
