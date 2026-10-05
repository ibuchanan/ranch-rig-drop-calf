import { describe, expect, test } from "bun:test";
import { applyPreclean, planPreclean } from "../src/preclean.ts";
import { DropCalf } from "../src/index.ts";

const scaffold = new Map([
  [
    "manifest.yml",
    "app:\n  id: ari:cloud:ecosystem::app/example\nmodules:\n  function: []\n",
  ],
  [
    "package.json",
    '{"name":"example","scripts":{"lint":"eslint ."},"dependencies":{"@forge/api":"^7.0.0"}}',
  ],
]);

describe("Forge bootstrap preclean", () => {
  test("previews conflicting generation paths and unwanted artifacts, not unrelated files", () => {
    const files = new Map([
      ...scaffold,
      ["README.md", "starter"],
      ["tsconfig.json", "{}"],
      ["AGENTS.md", "starter"],
      [".eslint", "starter"],
      ["eslint.config.js", "module.exports = {}"],
      ["src/index.ts", "keep"],
    ]);
    expect(planPreclean(files, "example").operations).toEqual([
      { action: "rename", path: "package.json", to: "package.json.old" },
      { action: "rename", path: "README.md", to: "README.md.old" },
      { action: "rename", path: "tsconfig.json", to: "tsconfig.json.old" },
      { action: "delete", path: "AGENTS.md" },
      { action: "delete", path: ".eslint" },
      { action: "delete", path: "eslint.config.js" },
    ]);
  });

  test("skips absent generated and unwanted paths", () => {
    expect(planPreclean(scaffold, "example").operations).toEqual([
      { action: "rename", path: "package.json", to: "package.json.old" },
    ]);
  });

  test("rejects backup collision before a mixed plan can mutate anything", () => {
    const files = new Map([
      ...scaffold,
      ["README.md", "starter"],
      ["README.md.old", "prior backup"],
      ["AGENTS.md", "delete candidate"],
    ]);
    expect(() => planPreclean(files, "example")).toThrow("README.md.old");
    expect(files.get("README.md")).toBe("starter");
    expect(files.get("README.md.old")).toBe("prior backup");
    expect(files.get("AGENTS.md")).toBe("delete candidate");
  });

  test("refuses a non-Forge project and a generated Forge project", () => {
    expect(() =>
      planPreclean(new Map([["README.md", "ordinary"]]), "example"),
    ).toThrow("Forge-created");
    const generated = new Map([
      ...scaffold,
      ["README.md", "<!-- drop-calf:usage start -->"],
    ]);
    expect(() => planPreclean(generated, "example")).toThrow(
      "already generated",
    );
    const custom = new Map(scaffold);
    custom.set(
      "package.json",
      '{"name":"example","dependencies":{"@forge/api":"^7.0.0"}}',
    );
    expect(() => planPreclean(custom, "example")).toThrow("Forge-created");
    const maintained = new Map([
      ...scaffold,
      ["README.md", "edited docs"],
      ["biome.json", "{}"],
      [".nvmrc", "24\n"],
    ]);
    expect(() => planPreclean(maintained, "example")).toThrow(
      "already generated",
    );
  });

  test("public preview and apply use the same plan without changing the source", async () => {
    const files = new Map([
      ...scaffold,
      ["README.md", "starter"],
      ["AGENTS.md", "remove"],
    ]);
    const writes: string[] = [];
    const source = {
      exists: async (path: string) => files.has(path),
      file: (path: string) => ({ contents: async () => files.get(path) }),
      withFile: (path: string, _file: unknown) => {
        writes.push(path);
        return source;
      },
      withoutFile: (path: string) => {
        writes.push(`-${path}`);
        return source;
      },
    };
    const calf = new DropCalf();
    const preview = JSON.parse(
      await calf.previewPreclean(source as never, "example"),
    );
    expect(preview).toEqual(planPreclean(files, "example").operations);
    expect(writes).toEqual([]);
    expect(await calf.preclean(source as never, "example")).toBe(
      source as never,
    );
    expect(writes).toEqual([
      "package.json.old",
      "-package.json",
      "README.md.old",
      "-README.md",
      "-AGENTS.md",
    ]);
  });

  test("public preclean refuses a backup collision without any Directory writes", async () => {
    const files = new Map([
      ...scaffold,
      ["README.md", "starter"],
      ["README.md.old", "backup"],
      ["AGENTS.md", "delete candidate"],
    ]);
    const writes: string[] = [];
    const directory = {
      exists: async (path: string) => files.has(path),
      file: (path: string) => ({ contents: async () => files.get(path) }),
      withFile: (path: string) => {
        writes.push(path);
        return directory;
      },
      withoutFile: (path: string) => {
        writes.push(path);
        return directory;
      },
    };
    await expect(
      new DropCalf().preclean(directory as never, "example"),
    ).rejects.toThrow("README.md.old");
    expect(writes).toEqual([]);
  });

  test("applies mixed rename/delete operations without changing the source", () => {
    const files = new Map([
      ...scaffold,
      ["README.md", "starter"],
      ["AGENTS.md", "starter guide"],
      ["src/index.ts", "keep"],
    ]);
    const result = applyPreclean(planPreclean(files, "example"));
    expect(result.get("package.json.old")).toBe(files.get("package.json"));
    expect(result.get("README.md.old")).toBe("starter");
    expect(result.has("package.json")).toBe(false);
    expect(result.has("README.md")).toBe(false);
    expect(result.has("AGENTS.md")).toBe(false);
    expect(result.get("src/index.ts")).toBe("keep");
    expect(files.has("README.md")).toBe(true);
  });
});
