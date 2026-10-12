import { describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import {
  OSS_ASSETS,
  OSS_UPSTREAM,
  PINNED_OSS,
  PINNED_OSS_UPSTREAM,
  transformOssTemplate,
} from "../src/oss.ts";
import { PRELINT_SCRIPTS } from "../src/prelint.ts";
import { buildProject } from "../src/profiles.ts";
import { SECRETS_ASSETS } from "../src/secrets.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory } from "./module-source.ts";
import { mockOssSource, ossTemplates } from "./oss-source.ts";
import {
  biomeTemplates,
  changelogTemplates,
  docsTemplates,
  gitHooksTemplates,
  promptfooTemplates,
  typescriptTemplates,
  vitestTemplates,
} from "./templates-source.ts";

const root = join(import.meta.dir, "..");
const vendor = join(root, PINNED_OSS);

describe("pinned OSS templates", () => {
  test("records the upstream commit it was pinned from", () => {
    expect(readFileSync(join(root, PINNED_OSS_UPSTREAM), "utf8")).toMatch(
      new RegExp(`^${OSS_UPSTREAM.replaceAll(".", "\\.")} [0-9a-f]{40}\\n$`),
    );
  });

  test("tracks every file in the pinned OSS template", () => {
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
      expect(project.packageJson.license).toBeUndefined();

      for (const path of OSS_ASSETS) {
        const template = readFileSync(join(vendor, path), "utf8");
        const expected =
          path === ".atlassian/OWNER"
            ? "tester"
            : path === "README.md" || path === "CONTRIBUTING.md"
              ? template.replaceAll("[Project name]", "example-project")
              : path === "LICENSE"
                ? template.replaceAll("[YYYY]", "2020-2024")
                : template;
        expect(
          transformOssTemplate(path, template, {
            name: "example-project",
            owner: "tester",
            copyrightDate: "2020-2024",
          }),
        ).toBe(expected);
        expect(project.files.has(path)).toBe(false);
      }
    },
  );

  test("copyOss exposes the module's OSS templates through Dagger", async () => {
    const module = mockOssSource();
    try {
      const writes = new Map<string, string>();
      const destination = mockDirectory(
        new Map([
          [
            "catalog-info.yaml",
            "metadata:\n  title: sample\n  annotations:\n    forge-ranch/license: Apache-2.0\n    forge-ranch/copyright-date: '2024'\nspec:\n  owner: user:default/tester\n",
          ],
        ]),
      );
      const output = await new DropCalf().copyOss(destination);
      for (const [path, contents] of (
        output as ReturnType<typeof mockDirectory>
      ).files)
        writes.set(path, contents);
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

  test.each(
    ["library", "forge-app", "tool", "agent-skill"].flatMap((kind) =>
      [undefined, "all"].map((preset) => ({
        kind,
        preset,
        presetName: preset ?? "default",
      })),
    ),
  )(
    "$kind init renders the selected package and all assets (preset $presetName)",
    async ({ kind, preset }) => {
      const writes = new Map<string, string>();
      const modes = new Map<string, number | undefined>();
      const directory = {
        files: writes,
        exists: async (path: string) => writes.has(path),
        file: (path: string) => ({ contents: async () => writes.get(path) }),
        withNewFile(
          path: string,
          contents: string,
          options?: { permissions?: number },
        ) {
          writes.set(path, contents);
          modes.set(path, options?.permissions);
          return directory;
        },
        withFile(path: string, file: { text: string }) {
          writes.set(path, file.text);
          return directory;
        },
        withDirectory(
          _path: string,
          source: { files: ReadonlyMap<string, string> },
        ) {
          for (const [path, contents] of source.files)
            writes.set(path, contents);
          return directory;
        },
      } as unknown as Directory;
      const stub = spyOn(dag, "directory").mockReturnValue(directory);
      const oss = mockOssSource();
      try {
        const output = await new DropCalf().init(
          mockDirectory(),
          kind,
          "tester",
          "sample",
          "A sample project",
          "",
          [],
          [],
          preset,
        );
        writes.set(
          "package.json",
          await output.file("package.json").contents(),
        );
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          "",
          [],
          [],
          preset,
        );
        expect(JSON.parse(writes.get("package.json") ?? "null")).toEqual({
          ...project.packageJson,
          scripts: {
            ...project.packageJson.scripts,
            ...(kind === "forge-app"
              ? PRELINT_SCRIPTS
              : {
                  test: "bun test --pass-with-no-tests",
                  "test:watch": "bun test --watch --pass-with-no-tests",
                  "test:coverage": "bun test --coverage --pass-with-no-tests",
                }),
          },
          devDependencies: {
            ...project.packageJson.devDependencies,
            ...(kind === "forge-app"
              ? {
                  "@ast-grep/cli": TOOL_VERSIONS.astGrep,
                  "@forge-ahead/prelint": TOOL_VERSIONS.forgePrelint,
                }
              : {}),
          },
          license: "Apache-2.0",
        });
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
        const seeded = new Map([
          ...biomeTemplates(),
          ...typescriptTemplates(),
          ...(kind === "forge-app" ? vitestTemplates() : []),
          ...(kind === "forge-app" && preset === "all"
            ? promptfooTemplates()
            : []),
          ...gitHooksTemplates(),
          ...docsTemplates(),
          ...(kind === "agent-skill" ? [] : changelogTemplates()),
        ]);
        for (const [path, contents] of seeded)
          expect(writes.get(path)).toBe(contents);
        expect(writes.has("cliff.toml")).toBe(kind !== "agent-skill");
        expect(writes.has("CHANGELOG.md")).toBe(kind !== "agent-skill");
        if (kind === "forge-app") {
          expect(writes.get("secretspec.toml")).toContain('name = "sample"');
          expect(writes.get("secretspec.toml")).not.toContain("[project-name]");
          expect(modes.get("scripts/env-var.sh")).toBe(0o755);
          expect(modes.get("scripts/forge-vars-from-secretspec.js")).toBe(
            0o755,
          );
        }
        expect(writes.get(".atlassian/OWNER")).toBe("tester");
        expect(writes.get("LICENSE")).toBe(
          ossTemplates()
            .get("LICENSE")
            ?.replaceAll("[YYYY]", String(new Date().getFullYear())),
        );
        expect([...writes.keys()].sort()).toEqual(
          [
            ...new Set([
              "package.json",
              "catalog-info.yaml",
              ".gitignore",
              ...(kind === "forge-app" ? SECRETS_ASSETS : []),
              ...project.files.keys(),
              ...OSS_ASSETS,
              ...seeded.keys(),
            ]),
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
