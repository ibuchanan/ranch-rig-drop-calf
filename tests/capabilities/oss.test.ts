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
import { capabilityOf, runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory } from "../support/module-source.ts";
import { mockOssSource, ossTemplates } from "../support/oss-source.ts";
import {
  biomeTemplates,
  catalogTemplates,
  changelogTemplates,
  docsTemplates,
  fallowTemplates,
  forgeDocsTemplates,
  gitHooksTemplates,
  libraryBuildTemplates,
  nodeTemplates,
  packageCheckTemplates,
  promptfooTemplates,
  releaseTemplates,
  skillStarterTemplates,
  typescriptBunTemplates,
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

/** A Directory double that records every write so tests can inspect the generated tree. */
function recordingDirectory() {
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
      for (const [path, contents] of source.files) writes.set(path, contents);
      return directory;
    },
  } as unknown as Directory;
  return { directory, writes, modes };
}

/** How a kind's package manager shows up in seeded guides and hook commands. */
type Runner = {
  rewrite: (guide: string) => string;
  rewriteHooks: (hooks: string) => string;
};
const NPM_RUNNER: Runner = {
  rewrite: (guide) => guide,
  rewriteHooks: (h) => h,
};
const BUN_RUNNER: Runner = {
  rewrite: (guide) =>
    guide
      .replaceAll("npm install", "bun install")
      .replaceAll("npm run", "bun run"),
  rewriteHooks: (hooks) =>
    hooks
      .replaceAll(/npm run (\S+) --if-present/g, "bun run --if-present $1")
      .replaceAll("npm run", "bun run"),
};

const BUN_TEST_SCRIPTS = {
  test: "bun test --pass-with-no-tests",
  "test:watch": "bun test --watch --pass-with-no-tests",
  "test:coverage": "bun test --coverage --pass-with-no-tests",
};

/** What `init` must add on top of the common project for one kind. */
type KindExpectations = {
  runner: Runner;
  /** Package.json content layered over the composed project. */
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts: Record<string, string>;
  typescript: () => ReadonlyMap<string, string>;
  /** Template trees seeded beyond the common ones, in seeding order. */
  templates: (preset: string | undefined) => ReadonlyMap<string, string>[];
  /** Files written through the recorder that are not templates. */
  extraFiles: readonly string[];
  /** Files only visible in the directory `init` returns. */
  readFromOutput: readonly string[];
  fileModes: Record<string, number>;
  /** `[path, fragment]` pairs the written file must / must not contain. */
  contains: readonly [string, string][];
  excludes: readonly [string, string][];
};

const whenPresetAll = (preset: string | undefined) =>
  preset === "all" ? [promptfooTemplates()] : [];

const KIND_EXPECTATIONS: Record<string, KindExpectations> = {
  library: {
    runner: NPM_RUNNER,
    scripts: {
      ...BUN_TEST_SCRIPTS,
      clean: "rm -rf node_modules package-lock.json dist",
    },
    typescript: typescriptTemplates,
    templates: () => [
      libraryBuildTemplates(),
      nodeTemplates(),
      packageCheckTemplates(),
      fallowTemplates(),
    ],
    extraFiles: ["AGENTS.md"],
    readFromOutput: ["tsconfig.declarations.json"],
    fileModes: {},
    contains: [],
    excludes: [],
  },
  "forge-app": {
    runner: NPM_RUNNER,
    dependencies: {
      "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
      "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
    },
    devDependencies: {
      "@ast-grep/cli": TOOL_VERSIONS.astGrep,
      "@forge-ahead/prelint": TOOL_VERSIONS.forgePrelint,
      "fence-rider": TOOL_VERSIONS.fenceRider,
    },
    scripts: { ...PRELINT_SCRIPTS, clean: "rm -rf dist" },
    typescript: typescriptTemplates,
    templates: (preset) => [
      vitestTemplates(),
      forgeDocsTemplates(),
      nodeTemplates(),
      ...whenPresetAll(preset),
    ],
    extraFiles: ["AGENTS.md", ...SECRETS_ASSETS],
    readFromOutput: [],
    fileModes: {},
    contains: [["secretspec.toml", 'name = "sample"']],
    excludes: [["secretspec.toml", "[project-name]"]],
  },
  tool: {
    runner: BUN_RUNNER,
    scripts: { ...BUN_TEST_SCRIPTS, clean: "rm -rf dist" },
    typescript: typescriptBunTemplates,
    templates: () => [fallowTemplates()],
    extraFiles: ["bunfig.toml"],
    readFromOutput: [],
    fileModes: {},
    contains: [],
    excludes: [],
  },
  "agent-skill": {
    runner: BUN_RUNNER,
    scripts: { ...BUN_TEST_SCRIPTS, clean: "rm -rf dist" },
    typescript: typescriptBunTemplates,
    templates: (preset) => [skillStarterTemplates(), ...whenPresetAll(preset)],
    extraFiles: ["AGENTS.md", "bunfig.toml"],
    readFromOutput: [],
    fileModes: {},
    contains: [],
    excludes: [],
  },
};

function expectedPackageJson(
  project: ReturnType<typeof buildProject>["packageJson"],
  { dependencies, devDependencies, scripts }: KindExpectations,
) {
  return {
    ...project,
    ...(dependencies && {
      dependencies: { ...project.dependencies, ...dependencies },
    }),
    scripts: { ...project.scripts, ...scripts },
    devDependencies: { ...project.devDependencies, ...devDependencies },
    license: "Apache-2.0",
  };
}

/** Every template tree `init` seeds for a kind, later trees overriding earlier ones. */
function seededTemplates(
  expected: KindExpectations,
  preset?: string,
  kind?: string,
) {
  return new Map([
    ...biomeTemplates(),
    ...[...expected.typescript()].filter(
      ([path]) => path !== "tsconfig.declarations.json",
    ),
    ...gitHooksTemplates(),
    ...docsTemplates(),
    ...expected.templates(preset).flatMap((tree) => [...tree]),
    ...changelogTemplates(),
    ...(kind === "forge-app" ? [] : releaseTemplates()),
  ]);
}

/** The exact text `init` writes for every file fully determined by a template. */
async function addReleaseScript(kind: string, seeded: Map<string, string>) {
  if (kind === "forge-app") return;
  const output = await runUpdate(
    capabilityOf(kind, "release"),
    mockDirectory(new Map([["package.json", "{}"]])),
  );
  seeded.set(
    "scripts/release.sh",
    await output.file("scripts/release.sh").contents(),
  );
}

function expectedContents(
  expected: KindExpectations,
  seeded: ReadonlyMap<string, string>,
): Map<string, string | undefined> {
  const oss = ossTemplates();
  return new Map<string, string | undefined>([
    // DEVELOPMENT.md only has to start with its template; it gains a layout section.
    ...[...seeded]
      .filter(([path]) => path !== "DEVELOPMENT.md")
      .map(([path, contents]): [string, string] => [
        path,
        path === "lefthook.yml"
          ? expected.runner.rewriteHooks(contents)
          : contents,
      ]),
    ["README.md", oss.get("README.md")?.replaceAll("[Project name]", "sample")],
    ["CODE_OF_CONDUCT.md", oss.get("CODE_OF_CONDUCT.md")],
    [".atlassian/OWNER", "tester"],
    [
      "LICENSE",
      oss
        .get("LICENSE")
        ?.replaceAll("[YYYY]", String(new Date().getFullYear())),
    ],
  ]);
}

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
      const expected = KIND_EXPECTATIONS[kind];
      if (!expected) throw new Error(`No expectations for kind ${kind}`);
      const recorder = recordingDirectory();
      const { writes, modes } = recorder;
      const stub = spyOn(dag, "directory").mockReturnValue(recorder.directory);
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
        // These files come back in the returned directory, not through the recorder.
        for (const path of ["package.json", ...expected.readFromOutput])
          writes.set(path, await output.file(path).contents());
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          [],
          [],
          preset,
        );
        expect(JSON.parse(writes.get("package.json") ?? "null")).toEqual(
          expectedPackageJson(project.packageJson, expected),
        );
        const seeded = seededTemplates(expected, preset, kind);
        await addReleaseScript(kind, seeded);
        for (const [path, contents] of expectedContents(expected, seeded))
          expect(writes.get(path), path).toBe(contents);
        expect(
          writes
            .get("DEVELOPMENT.md")
            ?.startsWith(
              expected.runner.rewrite(
                seeded.get("DEVELOPMENT.md") ?? "missing docs template",
              ),
            ),
        ).toBe(true);
        expect(writes.has("cliff.toml")).toBe(true);
        expect(writes.has("CHANGELOG.md")).toBe(true);
        for (const [path, fragment] of expected.contains)
          expect(writes.get(path)).toContain(fragment);
        for (const [path, fragment] of expected.excludes)
          expect(writes.get(path)).not.toContain(fragment);
        for (const [path, mode] of Object.entries(expected.fileModes))
          expect(modes.get(path)).toBe(mode);
        expect([...writes.keys()].sort()).toEqual(
          [
            ...new Set([
              "package.json",
              "catalog-info.yaml",
              ".gitignore",
              ...expected.extraFiles,
              ...expected.readFromOutput,
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
