import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { copyDocs, docPaths } from "../src/docs.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { docsTemplates } from "./templates-source.ts";

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
  const docs = {} as Directory;
  const module = spyOn(dag, "currentModule").mockReturnValue({
    source: () => ({
      directory: (path: string) => {
        expect(path).toBe("templates/docs");
        return docs;
      },
    }),
  } as unknown as ReturnType<typeof dag.currentModule>);
  try {
    const destination = {
      withDirectory: (path: string, source: Directory) => {
        expect(path).toBe(".");
        expect(source).toBe(docs);
        return destination;
      },
    } as unknown as Directory;
    expect(new DropCalf().copyDocs(destination)).toBe(destination);
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
  const templates = docs;
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

test("the docs tree pins the cspell and markdownlint config it needs", () => {
  // Matched by shape, not by name: the configs are template content, and a
  // rename should not read as a behaviour change. What is load-bearing is
  // that both tools find a config here at all, and that cspell is told to
  // skip installed dependencies.
  const docs = docsTemplates();
  const config = (pattern: RegExp) => {
    const entry = [...docs].find(([path]) => pattern.test(path));
    if (!entry) throw new Error(`no ${pattern} in the docs tree`);
    return entry[1];
  };
  const ignorePaths = JSON.parse(
    config(/^\.cspell\.jsonc?$/).replace(/^\s*\/\/.*$/gm, ""),
  ).ignorePaths as string[];
  expect(ignorePaths).toContain("node_modules/**");
  expect(ignorePaths).toContain("vendor/**");
  expect(config(/^\.markdownlint-cli2\.jsonc$/)).toContain('"MD013"');
});

test("seeded docs stay inside the line length their own config enforces", () => {
  // Stricter than MD013, which only exempts tables and code blocks: this is
  // hand-wrapped prose, so an over-long line is always a mistake here.
  const overLong: string[] = [];
  for (const [path, contents] of docsTemplates()) {
    if (!path.endsWith(".md")) continue;
    for (const [index, line] of contents.split("\n").entries())
      if (line.length > 80)
        overLong.push(`${path}:${index + 1} (${line.length})`);
  }
  expect(overLong).toEqual([]);
});

test("every kind lints its seeded docs with cspell and markdownlint-cli2", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts["lint:docs"]).toBe(
      'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"',
    );
    expect(packageJson.devDependencies.cspell).toBe(TOOL_VERSIONS.cspell);
    expect(packageJson.devDependencies["markdownlint-cli2"]).toBe(
      TOOL_VERSIONS.markdownlintCli2,
    );
  }
});
