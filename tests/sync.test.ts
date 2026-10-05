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
    const derived = {} as Directory;
    const source = {
      exists: async (path: string) => path === "package.json",
      file: () => ({ contents: async () => original }),
      withNewFile: (path: string, contents: string) => {
        writes.push([path, contents]);
        return derived;
      },
    } as unknown as Directory;
    const output = await new DropCalf().sync(source, "tool");
    expect(output).toBe(derived);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("package.json");
    expect(JSON.parse(writes[0]?.[1] ?? "").scripts).toMatchObject({
      deploy: "echo deploy",
      lint: "biome lint",
    });
  });

  test("Dagger preview exposes the plan and no-op sync preserves the source directory", async () => {
    const contents = '{"name":"sample","scripts":{"lint":"biome lint"}}\n';
    const source = {
      exists: async () => true,
      file: () => ({ contents: async () => contents }),
      withNewFile: () => {
        throw new Error("unexpected write");
      },
    } as unknown as Directory;
    const calf = new DropCalf();
    const preview = JSON.parse(await calf.previewSync(source, "tool"));
    expect(preview).toContainEqual({
      path: "package.json",
      key: "scripts.typecheck",
      mode: "structured-merge",
      after: "tsc --noEmit",
    });
    const converged =
      applySync(
        planSync(new Map([["package.json", contents]]), "tool"),
      ).files.get("package.json") ?? "";
    const unchanged = {
      ...source,
      file: () => ({ contents: async () => converged }),
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
      exists: async () => true,
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
