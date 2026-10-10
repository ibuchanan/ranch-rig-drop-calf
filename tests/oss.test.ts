import { describe, expect, spyOn, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { OSS_ASSETS, transformOssTemplate } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { docsTemplates } from "./docs-source.ts";
import { mockOssSource, ossTemplates } from "./oss-source.ts";

const vendor = join(import.meta.dir, "../vendor/oss-templates");
// An uninitialized submodule has no assets; a partial checkout should fail, not skip.
const pinnedSuite = OSS_ASSETS.some((path) => existsSync(join(vendor, path)))
  ? describe
  : describe.skip;

pinnedSuite("pinned OSS templates", () => {
  test("tracks every file in the pinned OSS template for sync injection", () => {
    expect([...OSS_ASSETS].map(String).sort()).toEqual(
      [
        ...readdirSync(vendor).filter(
          (name) => name.endsWith(".md") || name === "LICENSE",
        ),
        ...readdirSync(join(vendor, ".atlassian")).map(
          (name) => `.atlassian/${name}`,
        ),
      ].sort(),
    );
  });

  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s applies template transformations correctly with fixture templates",
    (kind) => {
      const project = buildProject(
        kind,
        "example-project",
        "tester",
        "Example purpose",
        "Example Owner",
      );
      expect(project.packageJson.license).toBe("Apache-2.0");

      for (const path of OSS_ASSETS) {
        const template = readFileSync(join(vendor, path), "utf8");
        const expected =
          path === ".atlassian/OWNER"
            ? "tester"
            : path === "README.md" || path === "CONTRIBUTING.md"
              ? template.replaceAll("[Project name]", "example-project")
              : path === "LICENSE"
                ? template.replaceAll(
                    "[YYYY]",
                    String(new Date().getFullYear()),
                  )
                : template;
        expect(
          transformOssTemplate(path, template, "example-project", "tester"),
        ).toBe(expected);
        expect(project.files.has(path)).toBe(false);
      }
    },
  );

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
      expect(
        await new DropCalf().copyOss(destination, "sample", "tester"),
      ).toBe(destination);
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

  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s Dagger files renders the selected package and all assets",
    async (kind) => {
      const writes = new Map<string, string>();
      const directory = {
        withNewFile(path: string, contents: string) {
          writes.set(path, contents);
          return directory;
        },
        withFile(path: string, file: { text: string }) {
          writes.set(path, file.text);
          return directory;
        },
        withDirectory(
          _path: string,
          source: { file(path: string): { text: string } },
        ) {
          for (const path of docsTemplates().keys())
            writes.set(path, source.file(path).text);
          return directory;
        },
      } as unknown as Directory;
      const stub = spyOn(dag, "directory").mockReturnValue(directory);
      const oss = mockOssSource();
      try {
        await new DropCalf().files(
          kind,
          "tester",
          "sample",
          "A sample project",
        );
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
        );
        expect(JSON.parse(writes.get("package.json") ?? "null")).toEqual(
          project.packageJson,
        );
        expect(writes.get("README.md")).toBe(
          ossTemplates()
            .get("README.md")
            ?.replaceAll("[Project name]", "sample"),
        );
        expect(writes.get("CODE_OF_CONDUCT.md")).toBe(
          ossTemplates().get("CODE_OF_CONDUCT.md"),
        );
        expect(writes.get("DEVELOPMENT.md")).toBe(
          docsTemplates().get("DEVELOPMENT.md"),
        );
        expect([...writes.keys()].sort()).toEqual(
          [
            "package.json",
            ...project.files.keys(),
            ...OSS_ASSETS,
            ...docsTemplates().keys(),
          ].sort(),
        );
      } finally {
        oss.mockRestore();
        stub.mockRestore();
      }
    },
  );
});

test("docs template paths do not overlap OSS assets", () => {
  for (const path of docsTemplates().keys())
    expect(OSS_ASSETS).not.toContain(path);
});
