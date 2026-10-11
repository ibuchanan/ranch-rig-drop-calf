import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import { BIOME_SCRIPTS } from "../src/biome.ts";
import { validateCapabilities } from "../src/capability.ts";
import { CATALOG_FILE, PACKAGE_NAME, renderCatalog } from "../src/catalog.ts";
import { CHANGELOG_COMMAND } from "../src/changelog.ts";
import { GIT_HOOKS_SCRIPTS } from "../src/git-hooks.ts";
import { DropCalf } from "../src/index.ts";
import {
  packageMetadata,
  updatePackageMetadata,
  validatePackageMetadata,
} from "../src/package-metadata.ts";
import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";
import { TYPESCRIPT_SCRIPTS } from "../src/typescript.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { VITEST_SCRIPTS } from "../src/vitest.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { catalogTemplates } from "./templates-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];
const catalog = () =>
  renderCatalog(catalogTemplates().get(CATALOG_FILE) ?? "", {
    name: "@scope/sample",
    description: "Catalog description",
    owner: "tester",
    type: "tool",
  });
const repository = (pkg: unknown, contents = catalog()) =>
  mockDirectory(
    new Map([
      ["package.json", JSON.stringify(pkg)],
      [CATALOG_FILE, contents],
      ["owner.txt", "untouched"],
    ]),
  );
const manifest = async (
  directory:
    | ReturnType<typeof mockDirectory>
    | Awaited<ReturnType<typeof updatePackageMetadata>>,
) => JSON.parse(await directory.file("package.json").contents());

test.each(kinds)(
  "%s init is private and catalog-derived with or without a scaffold",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      for (const scaffold of [
        undefined,
        { private: false, author: "Scaffold author", name: "wrong" },
      ]) {
        const input = mockDirectory(
          new Map(scaffold ? [["package.json", JSON.stringify(scaffold)]] : []),
        );
        const output = await new DropCalf().init(
          input,
          kind,
          "tester",
          "@scope/sample",
          "Catalog description",
          "Ignored author",
        );
        expect(await manifest(output)).toMatchObject({
          name: "@scope/sample",
          description: "Catalog description",
          author: "tester",
          version: "0.1.0",
          type: "module",
          private: true,
        });
        expect(await new DropCalf().update(output, kind)).toBe(output);
      }
      expect(
        buildProject(kind, "sample", "tester", "", "Ignored author").packageJson
          .author,
      ).toBe("tester");
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test.each(kinds)(
  "%s update overwrites owned metadata and preserves release and unrelated fields",
  async (kind) => {
    const pkg = {
      name: "package-edit",
      description: "Package edit",
      author: { name: "Package author" },
      version: "2.4.1",
      type: "commonjs",
      private: false,
      license: "MIT",
      scripts: { custom: "echo custom" },
      dependencies: { custom: "^1.0.0" },
      publishConfig: { access: "public" },
      custom: [1, 2],
    };
    const source = mockModuleSource();
    try {
      const input = repository(pkg);
      const output = await new DropCalf().update(input, kind);
      expect(await manifest(output)).toEqual({
        ...pkg,
        scripts: {
          ...pkg.scripts,
          ...BIOME_SCRIPTS,
          ...GIT_HOOKS_SCRIPTS,
          ...(kind === "agent-skill" ? {} : { changelog: CHANGELOG_COMMAND }),
          typecheck: TYPESCRIPT_SCRIPTS.typecheck,
          ...(kind === "library" ? {} : { build: TYPESCRIPT_SCRIPTS.build }),
          ...(kind === "forge-app" ? VITEST_SCRIPTS : {}),
        },
        devDependencies: {
          "@biomejs/biome": TOOL_VERSIONS.biome,
          lefthook: TOOL_VERSIONS.lefthook,
          typescript: TOOL_VERSIONS.typescript,
          ...(kind === "agent-skill"
            ? {}
            : { "git-cliff": TOOL_VERSIONS.gitCliff }),
          ...(kind === "forge-app"
            ? {
                vitest: TOOL_VERSIONS.vitest,
                "@vitest/coverage-v8": TOOL_VERSIONS.vitest,
              }
            : {}),
        },
        name: "@scope/sample",
        description: "Catalog description",
        author: "tester",
        license: "Apache-2.0",
        type: "module",
        private: kind === "forge-app" || kind === "agent-skill",
      });
      expect(await output.file(CATALOG_FILE).contents()).toBe(
        await input.file(CATALOG_FILE).contents(),
      );
      expect(await output.file("owner.txt").contents()).toBe("untouched");
      expect(await manifest(input)).toEqual(pkg);
      expect(await new DropCalf().update(output, kind)).toBe(output);
    } finally {
      source.mockRestore();
    }
  },
);

test.each(["library", "tool"])(
  "%s update preserves removal of private for publication",
  async (kind) => {
    const output = await updatePackageMetadata(
      repository({ version: "3.0.0" }),
      kind,
    );
    expect(await manifest(output)).not.toHaveProperty("private");
    expect((await manifest(output)).version).toBe("3.0.0");
    expect(await updatePackageMetadata(output, kind)).toBe(output);
  },
);

test("init derives identity from edited catalog template bytes rather than input defaults", async () => {
  const source = mockModuleSource();
  const directory = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  const template = catalogTemplates().get(CATALOG_FILE) ?? "";
  const edited = template
    .replace('"[Package name]"', '"@template/package"')
    .replace('"[Description]"', '"Template description"')
    .replace('"[Owner]"', '"user:default/template-owner"');
  const contents = spyOn(
    dag.currentModule().source().directory("templates/catalog"),
    "file",
  ).mockReturnValue({
    contents: async () => edited,
  } as never);
  try {
    const output = await new DropCalf().init(
      mockDirectory(),
      "tool",
      "tester",
      "input-package",
      "Input description",
    );
    expect(await manifest(output)).toMatchObject({
      name: "@template/package",
      description: "Template description",
      author: "template-owner",
    });
  } finally {
    contents.mockRestore();
    directory.mockRestore();
    source.mockRestore();
  }
});

test("catalog edits drive package metadata, not sanitized identity or display title", async () => {
  const document = parseDocument(catalog());
  document.setIn(["metadata", "name"], "sanitized-id");
  document.setIn(["metadata", "title"], "A display title");
  document.setIn(["metadata", "annotations", PACKAGE_NAME], "@new/renamed");
  document.setIn(["spec", "owner"], "user:another-namespace/new-owner");
  document.setIn(["metadata", "description"], "");
  let output = await updatePackageMetadata(
    repository({ description: "stale" }, document.toString()),
    "tool",
  );
  expect(await manifest(output)).toMatchObject({
    name: "@new/renamed",
    description: "",
    author: "new-owner",
  });
  document.deleteIn(["metadata", "description"]);
  output = await updatePackageMetadata(
    output.withNewFile(CATALOG_FILE, document.toString()),
    "tool",
  );
  expect(await manifest(output)).not.toHaveProperty("description");
  expect(await updatePackageMetadata(output, "tool")).toBe(output);
});

test.each([
  [
    "missing package name",
    (doc: ReturnType<typeof parseDocument>) =>
      doc.deleteIn(["metadata", "annotations", PACKAGE_NAME]),
    PACKAGE_NAME,
  ],
  [
    "wrong package name type",
    (doc: ReturnType<typeof parseDocument>) =>
      doc.setIn(["metadata", "annotations", PACKAGE_NAME], 42),
    PACKAGE_NAME,
  ],
  [
    "wrong description type",
    (doc: ReturnType<typeof parseDocument>) =>
      doc.setIn(["metadata", "description"], []),
    "metadata.description",
  ],
  [
    "missing owner",
    (doc: ReturnType<typeof parseDocument>) => doc.deleteIn(["spec", "owner"]),
    "spec.owner",
  ],
  [
    "null owner",
    (doc: ReturnType<typeof parseDocument>) =>
      doc.setIn(["spec", "owner"], null),
    "spec.owner",
  ],
  [
    "group owner",
    (doc: ReturnType<typeof parseDocument>) =>
      doc.setIn(["spec", "owner"], "group:default/team"),
    "spec.owner",
  ],
])("update rejects unusable catalog: %s", async (_label, edit, message) => {
  const doc = parseDocument(catalog());
  (edit as (doc: ReturnType<typeof parseDocument>) => unknown)(doc);
  await expect(
    updatePackageMetadata(repository({}, doc.toString()), "tool"),
  ).rejects.toThrow(message as string);
});

test("update skips a missing package and rejects missing or malformed sources without inventing metadata", async () => {
  const empty = mockDirectory();
  expect(await updatePackageMetadata(empty, "forge-app")).toBe(empty);
  await expect(
    updatePackageMetadata(
      mockDirectory(new Map([["package.json", "{}"]])),
      "tool",
    ),
  ).rejects.toThrow("catalog-info.yaml is missing");
  for (const pkg of ["{broken", "null", "[]"]) {
    await expect(
      updatePackageMetadata(
        repository({}).withNewFile("package.json", pkg),
        "tool",
      ),
    ).rejects.toThrow(ParseError);
  }
  for (const yaml of [
    "metadata: [broken",
    "[]",
    "metadata: {}\nmetadata: {}\n",
  ]) {
    await expect(
      updatePackageMetadata(repository({}, yaml), "tool"),
    ).rejects.toThrow(ParseError);
  }
});

test("standalone validation accepts owner choices without catalog or policy comparison", async () => {
  for (const author of [
    "Another author",
    { name: "Another author", email: "person@example.com" },
  ]) {
    const contents = JSON.stringify({
      name: "@other/package",
      version: "9.0.0-beta.1",
      type: "commonjs",
      private: false,
      description: "",
      author,
    });
    const input = mockDirectory(new Map([["package.json", contents]]));
    expect(await validatePackageMetadata(input)).toEqual({
      status: "validated",
    });
    expect(await input.file("package.json").contents()).toBe(contents);
  }
  expect(
    await validatePackageMetadata(
      mockDirectory(new Map([["package.json", "{}"]])),
    ),
  ).toEqual({ status: "validated" });
  expect(await validatePackageMetadata(mockDirectory())).toEqual({
    status: "skipped",
    reason: "package.json is missing",
  });
});

test.each([
  [{ name: "bad name" }, "name-format"],
  [{ name: 1 }, "name"],
  [{ version: "not-semver" }, "version-format"],
  [{ description: 42 }, "description-type"],
  [{ private: "true" }, "private-type"],
  [{ type: "invalid" }, "valid-values-type"],
  [{ author: [] }, "author"],
  [{ author: { name: 42 } }, "author"],
])("standalone validation rejects malformed field %j", async (pkg, reason) => {
  const input = repository(pkg);
  expect(
    await validateCapabilities(input, [packageMetadata("forge-app")]),
  ).toEqual([
    {
      capability: "package-metadata",
      status: "failed",
      reason: expect.stringContaining(reason),
    },
  ]);
});
