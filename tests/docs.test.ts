import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { copyDocs, docPaths } from "../src/docs.ts";
import { DropCalf } from "../src/index.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";
import { docsTemplates, mockOssSource, ossTemplates } from "./oss-source.ts";

test("Dagger copies nested docs verbatim and discovers only files", async () => {
  const paths = ["guides/", "guides/setup.md", "DEVELOPMENT.md"];
  const source = {
    glob: async () => paths,
    exists: async (path: string, options: { expectedType: string }) => {
      expect(options.expectedType).toBe("REGULAR_TYPE");
      return path !== "guides/";
    },
  } as unknown as Directory;
  expect(await docPaths(source)).toEqual(["DEVELOPMENT.md", "guides/setup.md"]);

  const destination = {
    withDirectory: (path: string, directory: Directory) => {
      expect(path).toBe(".");
      expect(directory).toBe(source);
      return destination;
    },
  } as unknown as Directory;
  expect(copyDocs(destination, source)).toBe(destination);
});

test("copyDocs exposes the module's documentation templates through Dagger", () => {
  const module = mockOssSource();
  try {
    const destination = {
      withDirectory: (path: string, source: Directory) => {
        expect(path).toBe(".");
        expect(source).toBeDefined();
        return destination;
      },
    } as unknown as Directory;
    expect(new DropCalf().copyDocs(destination)).toBe(destination);
  } finally {
    module.mockRestore();
  }
});

test("copyOss exposes the module's OSS templates through Dagger", async () => {
  const module = mockOssSource();
  try {
    const writes = new Map<string, string>();
    const destination = {
      withNewFile: (path: string, contents: string) => {
        writes.set(path, contents);
        return destination;
      },
      withFile: (path: string, file: { text: string }) => {
        writes.set(path, file.text);
        return destination;
      },
    } as unknown as Directory;
    expect(await new DropCalf().copyOss(destination, "sample", "tester")).toBe(
      destination,
    );
    expect(writes.get("README.md")).toBe(
      ossTemplates().get("README.md")?.replaceAll("[Project name]", "sample"),
    );
    expect(writes.get("CODE_OF_CONDUCT.md")).toBe(
      ossTemplates().get("CODE_OF_CONDUCT.md"),
    );
  } finally {
    module.mockRestore();
  }
});

test("docs template paths do not overlap other generated files", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const generated = new Set([
      "package.json",
      ...buildProject(
        kind,
        "sample",
        "tester",
        "",
        "",
        [],
        [],
        "all",
      ).files.keys(),
      ...OSS_ASSETS,
    ]);
    for (const path of docsTemplates().keys())
      expect(generated.has(path)).toBe(false);
  }
});

test("sync seeds missing docs unchanged and preserves customized docs", () => {
  const project = buildProject("tool", "sample", "tester");
  const docs = docsTemplates();
  const files = new Map([
    ["package.json", JSON.stringify(project.packageJson)],
  ]);
  const templates = new Map([...ossTemplates(), ...docs]);
  const seeded = applySync(
    planSync(files, "tool", "tester", undefined, [], [], undefined, templates),
  ).files;
  for (const [path, contents] of docs) {
    expect(seeded.get(path)).toBe(contents);
    seeded.set(path, "# My guide\n");
  }
  expect(
    planSync(seeded, "tool", "tester", undefined, [], [], undefined, templates)
      .operations,
  ).toEqual([]);
});
