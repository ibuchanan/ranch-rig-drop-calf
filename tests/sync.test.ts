import { describe, expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import {
  applySync,
  ConflictError,
  ParseError,
  planSync,
  ValidationError,
} from "../src/sync.ts";

describe("repository sync", () => {
  test("adds Node 24 pins while preserving unrelated package metadata", () => {
    const files = new Map([
      [
        "package.json",
        JSON.stringify({
          name: "sample",
          engines: { bun: ">=1" },
          custom: { keep: true },
        }),
      ],
    ]);
    const plan = planSync(files, "tool");
    expect(plan.operations).toContainEqual({
      path: ".nvmrc",
      key: "node",
      mode: "create-if-absent",
      before: undefined,
      after: "24\n",
    });
    expect(plan.operations).toContainEqual({
      path: "package.json",
      key: "engines.node",
      mode: "structured-merge",
      before: undefined,
      after: "24.x",
    });
    const result = applySync(plan).files;
    expect(result.get(".nvmrc")).toBe("24\n");
    expect(JSON.parse(result.get("package.json") ?? "")).toMatchObject({
      engines: { bun: ">=1", node: "24.x" },
      custom: { keep: true },
    });
    expect(planSync(result, "tool").operations).toEqual([]);
  });

  test("rejects incompatible Node pins without changing the input", () => {
    for (const [path, content] of [
      [".nvmrc", "22\n"],
      ["package.json", '{"name":"sample","engines":{"node":"22.x"}}'],
    ] as const) {
      const files = new Map<string, string>([
        ["package.json", '{"name":"sample"}'],
      ]);
      files.set(path, content);
      expect(() => planSync(files, "tool")).toThrow(ConflictError);
      expect(files.get(path)).toBe(content);
      expect(files.size).toBe(path === ".nvmrc" ? 2 : 1);
    }
  });

  test("matching Node pins are no-ops", () => {
    const first = applySync(
      planSync(new Map([["package.json", '{"name":"sample"}']]), "tool"),
    ).files;
    const plan = planSync(first, "tool");
    expect(plan.operations).toEqual([]);
  });

  test("seeds missing OSS documents but preserves customized ones across repeated sync", () => {
    const files = new Map([
      [
        "package.json",
        '{"name":"sample","license":"MIT","author":"Maintainer"}',
      ],
      ["CONTRIBUTING.md", "# Our contribution rules\n"],
      ["LICENSE", "Our existing license terms\n"],
      ["README.md", "# Our own README\n"],
    ]);
    const plan = planSync(files, "tool");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({
        path: "DEVELOPMENT.md",
        mode: "create-if-absent",
      }),
    );
    expect(
      plan.operations.some(
        (op) =>
          op.path === "CONTRIBUTING.md" ||
          op.path === "LICENSE" ||
          op.path === "README.md",
      ),
    ).toBe(false);
    const result = applySync(plan).files;
    expect(result.get("CONTRIBUTING.md")).toBe("# Our contribution rules\n");
    expect(result.get("LICENSE")).toBe("Our existing license terms\n");
    expect(result.get("README.md")).toBe("# Our own README\n");
    expect(result.get("DEVELOPMENT.md")).toContain("npm run typecheck");
    const withoutReadme = planSync(
      new Map([["package.json", '{"name":"sample"}']]),
      "tool",
    );
    expect(withoutReadme.operations).toContainEqual(
      expect.objectContaining({ path: "README.md", mode: "create-if-absent" }),
    );
    expect(result.get("CODE_OF_CONDUCT.md")).toContain("harassment-free");
    expect(result.get(".atlassian/OWNER")).toBe("Maintainer\n");
    expect(planSync(result, "tool").operations).toEqual([]);
  });
  test("adds missing ignore rules without disturbing custom entries or comments", () => {
    const original = "# mine\ncustom-cache\nnode_modules\n# keep\n";
    const files = new Map([
      ["package.json", '{"name":"sample"}'],
      [".gitignore", original],
    ]);
    const plan = planSync(files, "tool");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: ".gitignore", mode: "line-set" }),
    );
    expect(files.get(".gitignore")).toBe(original);
    const result = applySync(plan).files;
    const ignore = result.get(".gitignore") ?? "";
    expect(ignore).toStartWith(original);
    expect(ignore.match(/^node_modules$/gm)).toHaveLength(1);
    expect(ignore).toContain("dist\n");
    expect(planSync(result, "tool").operations).toEqual([]);
  });

  test("selects named ignore sets and rejects unknown names before applying", () => {
    const files = new Map([["package.json", '{"name":"sample"}']]);
    const result = applySync(planSync(files, "tool", ["node"])).files;
    expect(result.get(".gitignore")).toContain("node_modules");
    expect(result.get(".gitignore")).not.toContain(".DS_Store");
    expect(() => planSync(files, "tool", ["unknown"])).toThrow(/unknown/);
    expect(files.has(".gitignore")).toBe(false);
  });

  test("merges EditorConfig by section without replacing user keys", () => {
    const original =
      "root = true\n\n[*]\nindent_size = 4\ncustom = yes\n\n[*.ts]\nindent_size = 8\n";
    const files = new Map([
      ["package.json", '{"name":"sample"}'],
      [".editorconfig", original],
    ]);
    const plan = planSync(files, "tool");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: ".editorconfig", mode: "section-map" }),
    );
    const result = applySync(plan).files;
    const text = result.get(".editorconfig") ?? "";
    expect(text).toContain("indent_size = 4");
    expect(text).toContain("custom = yes");
    expect(text).toContain("[*.ts]\nindent_size = 8");
    expect(text).toContain("charset = utf-8");
    expect(text).toContain("[*.md]");
    expect(planSync(result, "tool").operations).toEqual([]);
  });

  test("updates only a marked README region and preserves surrounding prose", () => {
    const original =
      "# My docs\n\nMy intro.\n\n<!-- drop-calf:usage start -->\nold instructions\n<!-- drop-calf:usage end -->\n\nMy outro.\n";
    const files = new Map([
      ["package.json", '{"name":"sample"}'],
      ["README.md", original],
    ]);
    const plan = planSync(files, "tool");
    expect(plan.operations).toContainEqual(
      expect.objectContaining({ path: "README.md", mode: "managed-region" }),
    );
    const result = applySync(plan).files;
    const readme = result.get("README.md") ?? "";
    expect(readme).toStartWith("# My docs\n\nMy intro.");
    expect(readme).toContain("My outro.\n");
    expect(readme).not.toContain("old instructions");
    expect(readme).toContain("npm run build");
    expect(planSync(result, "tool").operations).toEqual([]);
    expect(
      planSync(
        new Map([
          ["package.json", '{"name":"sample"}'],
          ["README.md", "# Unmarked custom docs\n"],
        ]),
        "tool",
      ).operations.some((op) => op.path === "README.md"),
    ).toBe(false);
  });

  test("rejects malformed README markers and ambiguous EditorConfig without mutating input", () => {
    const files = new Map([
      ["package.json", '{"name":"sample"}'],
      ["README.md", "<!-- drop-calf:usage start -->\nunfinished"],
    ]);
    expect(() => planSync(files, "tool")).toThrow(ParseError);
    expect(files.get("README.md")).toContain("unfinished");
    expect(() =>
      planSync(
        new Map([
          ["package.json", '{"name":"sample"}'],
          [".editorconfig", "[*]\nindent_size = 2\nindent_size = 4\n"],
        ]),
        "tool",
      ),
    ).toThrow(ParseError);
  });

  test("previews owned-key edits and preserves unrelated package fields and files", () => {
    const existing = new Map([
      [
        "package.json",
        `${JSON.stringify({ name: "sample", version: "2.0.0", custom: { keep: true }, scripts: { deploy: "echo deploy" }, devDependencies: { custom: "1.0.0" } })}\n`,
      ],
      ["src/index.ts", "export const answer = 42;\n"],
    ]);
    const plan = planSync(existing, "tool");
    expect(plan.operations).toContainEqual({
      path: "package.json",
      key: "scripts.lint",
      mode: "structured-merge",
      before: undefined,
      after: "biome lint",
    });
    const result = applySync(plan);
    expect(result.files.get("src/index.ts")).toBe(
      "export const answer = 42;\n",
    );
    expect(JSON.parse(result.files.get("package.json") ?? "")).toMatchObject({
      name: "sample",
      version: "2.0.0",
      custom: { keep: true },
      scripts: { deploy: "echo deploy", lint: "biome lint" },
      devDependencies: { custom: "1.0.0" },
    });
    expect(result.journal).toEqual({
      outcome: "validated",
      operations: plan.operations.length,
    });
  });

  test("validates applied values before recording a successful journal outcome", () => {
    const plan = planSync(
      new Map([["package.json", '{"name":"sample"}']]),
      "tool",
    );
    const lint = plan.operations.find(
      (operation) => operation.key === "scripts.lint",
    );
    if (!lint) throw new Error("missing planned lint script");
    lint.after = "wrong command";
    expect(() => applySync(plan)).toThrow(ValidationError);
  });

  test("repeated sync has no semantic changes", () => {
    const first = applySync(
      planSync(new Map([["package.json", '{"name":"sample"}\n']]), "library"),
    );
    const second = planSync(first.files, "library");
    expect(second.operations).toEqual([]);
    expect(applySync(second).files).toEqual(first.files);
  });

  test("rejects incompatible owned scripts before applying anything", () => {
    const original =
      '{"name":"sample","scripts":{"lint":"eslint .","deploy":"echo deploy"}}\n';
    const files = new Map([["package.json", original]]);
    expect(() => planSync(files, "tool")).toThrow(ConflictError);
    expect(files.get("package.json")).toBe(original);
    expect([...files.keys()]).toEqual(["package.json"]);
  });

  test("Dagger sync returns a reviewable derived directory without modifying its input", async () => {
    const original = '{"name":"sample","scripts":{"deploy":"echo deploy"}}\n';
    const writes: Array<[string, string]> = [];
    const source = {
      exists: async (path: string) => path === "package.json",
      file: () => ({ contents: async () => original }),
      withNewFile: (path: string, contents: string) => {
        writes.push([path, contents]);
        return source;
      },
    } as unknown as Directory;
    const output = await new DropCalf().sync(source, "tool");
    expect(output).toBe(source);
    expect(writes.map(([path]) => path)).toEqual([
      ".nvmrc",
      "CONTRIBUTING.md",
      "CODE_OF_CONDUCT.md",
      "DEVELOPMENT.md",
      "README.md",
      "package.json",
      ".gitignore",
      ".editorconfig",
    ]);
    const packageWrite = writes.find(([path]) => path === "package.json");
    expect(JSON.parse(packageWrite?.[1] ?? "").scripts).toMatchObject({
      deploy: "echo deploy",
      lint: "biome lint",
    });
  });

  test("Dagger sync reads existing shared text and writes only planned changes", async () => {
    const original = new Map([
      ["package.json", '{"name":"sample"}'],
      [".gitignore", "# custom\nprivate/\nnode_modules\n"],
      [".editorconfig", "root = true\n\n[*]\nindent_size = 4\n"],
      ["README.md", "# Custom docs\n\nOutside.\n"],
    ]);
    const writes = new Map<string, string>();
    const directory = {
      exists: async (path: string) => original.has(path),
      file: (path: string) => ({ contents: async () => original.get(path) }),
      withNewFile: (path: string, contents: string) => {
        writes.set(path, contents);
        return directory;
      },
    } as unknown as Directory;
    const calf = new DropCalf();
    expect(
      JSON.parse(await calf.previewSync(directory, "tool")).map(
        (op: { path: string }) => op.path,
      ),
    ).not.toContain("README.md");
    await calf.sync(directory, "tool");
    expect(writes.get(".gitignore")).toStartWith(
      original.get(".gitignore") ?? "",
    );
    expect(writes.get(".editorconfig")).toContain("indent_size = 4");
    expect(writes.has("README.md")).toBe(false);
    expect(original.get(".gitignore")).toBe(
      "# custom\nprivate/\nnode_modules\n",
    );
  });

  test("Dagger preview exposes the plan and no-op sync preserves the source directory", async () => {
    const contents = '{"name":"sample","scripts":{"lint":"biome lint"}}\n';
    const source = {
      exists: async (path: string) => path === "package.json",
      file: () => ({ contents: async () => contents }),
      withNewFile: () => {
        throw new Error("unexpected write");
      },
    } as unknown as Directory;
    const calf = new DropCalf();
    const preview = JSON.parse(await calf.previewSync(source, "tool"));
    const selected = JSON.parse(
      await calf.previewSync(source, "tool", ["node"]),
    );
    expect(
      selected.find((op: { path: string }) => op.path === ".gitignore")?.after,
    ).not.toContain(".DS_Store");
    expect(preview).toContainEqual({
      path: "package.json",
      key: "scripts.typecheck",
      mode: "structured-merge",
      after: "tsc --noEmit",
    });
    const converged = applySync(
      planSync(new Map([["package.json", contents]]), "tool"),
    ).files;
    const unchanged = {
      ...source,
      exists: async (path: string) => converged.has(path),
      file: (path: string) => ({ contents: async () => converged.get(path) }),
    } as unknown as Directory;
    expect(await calf.sync(unchanged, "tool")).toBe(unchanged);
  });

  test("refuses a missing package or invalid metadata before a directory can be produced", () => {
    expect(() => planSync(new Map(), "tool")).toThrow(ValidationError);
    expect(() =>
      planSync(new Map([["package.json", '{"scripts":{}}']]), "tool"),
    ).toThrow(/package.json.*name/);
  });

  test("rejects drifted dependencies and malformed owned sections before directory output", async () => {
    const original =
      '{"name":"sample","devDependencies":{"typescript":"^4.0.0"}}';
    let wrote = false;
    const source = {
      exists: async (path: string) => path === "package.json",
      file: () => ({ contents: async () => original }),
      withNewFile: () => {
        wrote = true;
        return source;
      },
    } as unknown as Directory;
    await expect(new DropCalf().sync(source, "tool")).rejects.toThrow(
      /devDependencies.typescript/,
    );
    expect(wrote).toBe(false);
    expect(() =>
      planSync(
        new Map([["package.json", '{"name":"sample","scripts":[]}']]),
        "tool",
      ),
    ).toThrow(ParseError);
  });

  test("reports malformed package.json as a contextual parse error", () => {
    expect(() => planSync(new Map([["package.json", "{"]]), "tool")).toThrow(
      ParseError,
    );
    expect(() => planSync(new Map([["package.json", "{"]]), "tool")).toThrow(
      /package.json/,
    );
  });
});
