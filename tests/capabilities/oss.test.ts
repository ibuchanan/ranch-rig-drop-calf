import { describe, expect, spyOn, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import {
  CATALOG_FILE,
  COPYRIGHT_DATE,
  LICENSE,
  renderCatalog,
} from "../../src/capabilities/catalog.ts";
import {
  copyOssAssets,
  OSS_ASSETS,
  OSS_UPSTREAM,
  oss,
  PINNED_OSS,
  PINNED_OSS_UPSTREAM,
  transformOssTemplate,
} from "../../src/capabilities/oss.ts";
import { PRELINT_SCRIPTS } from "../../src/capabilities/prelint.ts";
import { SECRETS_ASSETS } from "../../src/capabilities/secrets.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory } from "../support/module-source.ts";
import { mockOssSource, ossTemplates } from "../support/oss-source.ts";
import {
  biomeTemplates,
  catalogTemplates,
  changelogTemplates,
  docsTemplates,
  fallowTemplates,
  gitHooksTemplates,
  libraryBuildTemplates,
  promptfooTemplates,
  typescriptTemplates,
  vitestTemplates,
} from "../support/templates-source.ts";

const root = join(import.meta.dir, "../..");
const vendor = join(root, PINNED_OSS);

const catalog = () =>
  renderCatalog(catalogTemplates().get(CATALOG_FILE) ?? "", {
    name: "Original title",
    owner: "tester",
    type: "tool",
    copyrightDate: "2020-2024",
  });
const assets = () => mockDirectory(ossTemplates());
const template = (path: string) => ossTemplates().get(path) ?? "";
const input = () =>
  mockDirectory(
    new Map([
      [CATALOG_FILE, catalog()],
      ["package.json", '{"license":"MIT","custom":true}'],
    ]),
  );

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
          [],
          [],
          preset,
        );
        writes.set(
          "package.json",
          await output.file("package.json").contents(),
        );
        if (kind === "library")
          writes.set(
            "tsconfig.declarations.json",
            await output.file("tsconfig.declarations.json").contents(),
          );
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          [],
          [],
          preset,
        );
        expect(JSON.parse(writes.get("package.json") ?? "null")).toEqual({
          ...project.packageJson,
          ...(kind === "forge-app"
            ? {
                dependencies: {
                  ...project.packageJson.dependencies,
                  "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
                  "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
                },
              }
            : {}),
          scripts: {
            ...project.packageJson.scripts,
            clean: "rm -rf dist",
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
        expect(
          writes
            .get("DEVELOPMENT.md")
            ?.startsWith(
              docsTemplates().get("DEVELOPMENT.md") ?? "missing docs template",
            ),
        ).toBe(true);
        const seeded = new Map([
          ...biomeTemplates(),
          ...[...typescriptTemplates()].filter(
            ([path]) => path !== "tsconfig.declarations.json",
          ),
          ...(kind === "library" ? libraryBuildTemplates() : []),
          ...(["library", "tool"].includes(kind) ? fallowTemplates() : []),
          ...(kind === "forge-app" ? vitestTemplates() : []),
          ...(kind === "forge-app" && preset === "all"
            ? promptfooTemplates()
            : []),
          ...gitHooksTemplates(),
          ...docsTemplates(),
          ...(kind === "agent-skill" ? [] : changelogTemplates()),
        ]);
        for (const [path, contents] of seeded)
          if (path !== "DEVELOPMENT.md")
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
              ...(kind === "forge-app" ? ["AGENTS.md", ...SECRETS_ASSETS] : []),
              ...project.files.keys(),
              ...OSS_ASSETS,
              ...seeded.keys(),
              ...(kind === "library" ? ["tsconfig.declarations.json"] : []),
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

test("OSS validation is an enumerable manual-inspection no-op, independent of catalog", async () => {
  expect(noOpReasons([oss()])).toEqual([
    {
      capability: "oss",
      verb: "validate",
      reason:
        "These documents require manual inspection; no consuming validator checks their acceptance.",
    },
  ]);
  expect(await validateCapabilities(mockDirectory(), [oss()])).toEqual([
    {
      capability: "oss",
      status: "skipped",
      reason:
        "These documents require manual inspection; no consuming validator checks their acceptance.",
    },
  ]);
  for (const kind of ["library", "forge-app", "tool", "agent-skill"])
    expect(
      resolveProfile(kind)
        .slice(0, 3)
        .map((item) => item.name),
    ).toEqual(["catalog", "package-metadata", "oss"]);
});

test("OSS update replaces authoritative documents and OWNER, leaves README/catalog/package unchanged", async () => {
  const source = mockOssSource();
  const clock = spyOn(Date.prototype, "getFullYear").mockImplementation(() => {
    throw new Error("OSS must not read the clock");
  });
  try {
    const fresh = await copyOssAssets(input(), assets());
    expect(await updateCapabilities(fresh, [oss()])).toBe(fresh);
    const document = parseDocument(catalog());
    document.setIn(["metadata", "title"], "Edited display name");
    document.setIn(["metadata", "annotations", COPYRIGHT_DATE], "2001-2009");
    document.setIn(["spec", "owner"], "user:other-namespace/new-owner");
    const catalogBytes = document.toString();
    let edited = fresh.withNewFile(CATALOG_FILE, catalogBytes);
    for (const path of OSS_ASSETS)
      edited = edited.withNewFile(path, `owner-authored ${path}\n`);
    const before = await edited.file("package.json").contents();
    const output = await updateCapabilities(edited, [oss()]);
    expect(await output.file("README.md").contents()).toBe(
      "owner-authored README.md\n",
    );
    expect(await output.file("CONTRIBUTING.md").contents()).toBe(
      template("CONTRIBUTING.md").replaceAll(
        "[Project name]",
        "Edited display name",
      ),
    );
    expect(await output.file("LICENSE").contents()).toBe(
      template("LICENSE").replaceAll("[YYYY]", "2001-2009"),
    );
    expect(await output.file(".atlassian/OWNER").contents()).toBe("new-owner");
    for (const path of ["CODE_OF_CONDUCT.md", "SECURITY.md"])
      expect(await output.file(path).contents()).toBe(template(path));
    expect(await output.file(CATALOG_FILE).contents()).toBe(catalogBytes);
    expect(await output.file("package.json").contents()).toBe(before);
    expect(await updateCapabilities(output, [oss()])).toBe(output);
    const absent = await updateCapabilities(input(), [oss()]);
    expect(await absent.exists("README.md")).toBe(false);
    for (const path of OSS_ASSETS.filter((path) => path !== "README.md"))
      expect(await absent.exists(path)).toBe(true);
    expect(await updateCapabilities(absent, [oss()])).toBe(absent);
  } finally {
    clock.mockRestore();
    source.mockRestore();
  }
});

test("init pulls OSS values from the edited catalog seed rather than metadata arguments", async () => {
  const source = mockOssSource();
  const directory = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  const editedTemplate = (catalogTemplates().get(CATALOG_FILE) ?? "")
    .replace('"[Project name]"', '"Catalog title"')
    .replace('"[Owner]"', '"user:default/catalog-owner"')
    .replace('"[Copyright date]"', '"1998-2000"');
  const file = spyOn(
    dag.currentModule().source().directory("templates/catalog"),
    "file",
  ).mockReturnValue({ contents: async () => editedTemplate } as never);
  try {
    const output = await new DropCalf().init(
      mockDirectory(),
      "tool",
      "argument-owner",
      "argument-name",
    );
    expect(await output.file("README.md").contents()).toBe(
      template("README.md").replaceAll("[Project name]", "Catalog title"),
    );
    expect(await output.file("CONTRIBUTING.md").contents()).toBe(
      template("CONTRIBUTING.md").replaceAll("[Project name]", "Catalog title"),
    );
    expect(await output.file(".atlassian/OWNER").contents()).toBe(
      "catalog-owner",
    );
    expect(await output.file("LICENSE").contents()).toBe(
      template("LICENSE").replaceAll("[YYYY]", "1998-2000"),
    );
    expect(
      JSON.parse(await output.file("package.json").contents()).license,
    ).toBe("Apache-2.0");
    expect(await new DropCalf().update(output, "tool")).toBe(output);
  } finally {
    file.mockRestore();
    directory.mockRestore();
    source.mockRestore();
  }
});

const mutations: [string, string[], unknown][] = [
  ["missing title", ["metadata", "title"], undefined],
  ["blank title", ["metadata", "title"], " "],
  ["non-string title", ["metadata", "title"], 42],
  ["missing owner", ["spec", "owner"], undefined],
  ["group owner", ["spec", "owner"], "group:default/team"],
  ["missing date", ["metadata", "annotations", COPYRIGHT_DATE], undefined],
  ["numeric date", ["metadata", "annotations", COPYRIGHT_DATE], 2024],
  ["reversed date", ["metadata", "annotations", COPYRIGHT_DATE], "2024-2020"],
  ["bad date", ["metadata", "annotations", COPYRIGHT_DATE], "2024-present"],
  ["missing license", ["metadata", "annotations", LICENSE], undefined],
  ["unsupported license", ["metadata", "annotations", LICENSE], "MIT"],
];
test.each(mutations)(
  "OSS refuses %s before writing assets",
  async (_label, path, value) => {
    const document = parseDocument(catalog());
    if (value === undefined) document.deleteIn(path);
    else document.setIn(path, value);
    const directory = input().withNewFile(CATALOG_FILE, document.toString());
    const write = spyOn(directory, "withNewFile");
    try {
      await expect(copyOssAssets(directory, assets())).rejects.toThrow(
        CATALOG_FILE,
      );
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  },
);

test.each([
  undefined,
  "[broken",
  "metadata: {}\nmetadata: {}\n",
  "- not-a-mapping\n",
])("OSS refuses missing or malformed catalog: %j", async (contents) => {
  const directory =
    contents === undefined
      ? mockDirectory()
      : mockDirectory(new Map([[CATALOG_FILE, contents]]));
  await expect(copyOssAssets(directory, assets())).rejects.toThrow(
    CATALOG_FILE,
  );
});

test("docs template paths do not overlap OSS assets", () => {
  for (const path of docsTemplates().keys())
    expect(OSS_ASSETS).not.toContain(path);
});
