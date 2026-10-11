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
import { buildProject } from "../src/profiles.ts";
import { SECRETS_ASSETS } from "../src/secrets.ts";
import { mockOssSource, ossTemplates } from "./oss-source.ts";
import {
  biomeTemplates,
  changelogTemplates,
  docsTemplates,
  gitHooksTemplates,
  typescriptTemplates,
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

  test.each(
    ["library", "forge-app", "tool", "agent-skill"].flatMap((kind) =>
      [undefined, "all"].map((preset) => ({
        kind,
        preset,
        presetName: preset ?? "default",
      })),
    ),
  )(
    "$kind Dagger files renders the selected package and all assets (preset $presetName)",
    async ({ kind, preset }) => {
      const writes = new Map<string, string>();
      const modes = new Map<string, number | undefined>();
      const directory = {
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
        await new DropCalf().files(
          kind,
          "tester",
          "sample",
          "A sample project",
          "",
          [],
          [],
          preset,
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
        const seeded = new Map([
          ...biomeTemplates(),
          ...typescriptTemplates(),
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
              // Seeded by `copyGitignore`, so the blueprint carries none.
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
