import { describe, expect, test } from "bun:test";
import { DropCalf } from "../src/index.ts";
import { applyPreclean, UNWANTED } from "../src/preclean.ts";

function directory(files: Map<string, string>) {
  const removed: string[] = [];
  const make = (contents: Map<string, string>) => ({
    exists: async (path: string) => contents.has(path),
    withoutFile: (path: string) => {
      removed.push(path);
      const next = new Map(contents);
      next.delete(path);
      return make(next);
    },
    changes: (before: unknown) => ({ before, removed: [...removed] }),
    entries: () => [...contents],
  });
  return { source: make(files), removed };
}

const preserved = new Map([
  ["manifest.yml", "app: ..."],
  ["package.json", '{"name":"example"}'],
  ["src/index.ts", "app source"],
]);
const starter = new Map([
  ...preserved,
  ...UNWANTED.map((path) => [path, `starter ${path}`] as const),
]);

describe("Forge bootstrap preclean", () => {
  test("deletes only present unwanted files through Dagger without changing the input", async () => {
    const { source, removed } = directory(starter);
    const result = await new DropCalf().removeScaffold(source as never);
    expect(removed).toEqual([...UNWANTED]);
    expect((result as unknown as typeof source).entries()).toEqual([
      ...preserved,
    ]);
    expect(source.entries()).toEqual([...starter]);
    expect((await applyPreclean(result)) as unknown).toBe(result);
  });

  test("skips absent unwanted files and preserves an unchanged directory", async () => {
    const { source, removed } = directory(new Map(preserved));
    expect(
      (await new DropCalf().removeScaffold(source as never)) as unknown,
    ).toBe(source);
    expect(removed).toEqual([]);
  });

  test("removeScaffoldChanges compares the cleaned snapshot to the original", async () => {
    const { source, removed } = directory(starter);
    expect(
      (await new DropCalf().removeScaffoldChanges(source as never)) as unknown,
    ).toEqual({ before: source, removed: [...UNWANTED] });
    expect(removed).toEqual([...UNWANTED]);
  });
});
