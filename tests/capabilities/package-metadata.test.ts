import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import fc from "fast-check";
import { parseDocument } from "yaml";
import {
  CATALOG_FILE,
  PACKAGE_NAME,
  renderCatalog,
} from "../../src/capabilities/catalog.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { validateCapabilities } from "../../src/core/capability.ts";
import { ParseError } from "../../src/core/errors.ts";
import { DropCalf } from "../../src/index.ts";
import {
  capabilityOf,
  runUpdate,
  verb,
} from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { catalogTemplates } from "../support/templates-source.ts";

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
    | Awaited<ReturnType<typeof runUpdate>>,
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
        buildProject(kind, "sample", "tester", "").packageJson.author,
      ).toBe("tester");
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test.each(kinds)(
  "%s metadata update preserves owner fields and release versions",
  async (kind) => {
    const capability = capabilityOf(kind, "package-metadata");
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          version: fc
            .tuple(
              fc.nat({ max: 999 }),
              fc.nat({ max: 999 }),
              fc.nat({ max: 999 }),
            )
            .map((parts) => parts.join(".")),
          private: fc.boolean(),
          scripts: fc.dictionary(
            fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/),
            fc.string({ maxLength: 80 }),
            { maxKeys: 4 },
          ),
          custom: fc.jsonValue({ maxDepth: 3 }),
        }),
        async (owner) => {
          const pkg = {
            ...owner,
            name: "package-edit",
            description: "Package edit",
            author: { name: "Package author" },
            type: "commonjs",
            license: "MIT",
            dependencies: { custom: "^1.0.0" },
            publishConfig: { access: "public" },
          };
          const input = repository(pkg);
          const before = [...input.files];
          const stored = await manifest(input);
          const output = await runUpdate(capability, input);
          expect(await manifest(output)).toEqual({
            ...stored,
            name: "@scope/sample",
            description: "Catalog description",
            author: "tester",
            type: "module",
            private:
              kind === "forge-app" || kind === "agent-skill"
                ? true
                : owner.private,
          });
          expect(await output.file(CATALOG_FILE).contents()).toBe(
            await input.file(CATALOG_FILE).contents(),
          );
          expect(await output.file("owner.txt").contents()).toBe("untouched");
          expect([...input.files]).toEqual(before);
          expect(await runUpdate(capability, output)).toBe(output);
        },
      ),
    );
  },
);

test.each(["library", "tool"])(
  "%s update preserves removal of private for publication",
  async (kind) => {
    const output = await runUpdate(
      capabilityOf(kind, "package-metadata"),
      repository({ version: "3.0.0" }),
    );
    expect(await manifest(output)).not.toHaveProperty("private");
    expect((await manifest(output)).version).toBe("3.0.0");
    expect(
      await runUpdate(capabilityOf(kind, "package-metadata"), output),
    ).toBe(output);
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
  let output = await runUpdate(
    capabilityOf("tool", "package-metadata"),
    repository({ description: "stale" }, document.toString()),
  );
  expect(await manifest(output)).toMatchObject({
    name: "@new/renamed",
    description: "",
    author: "new-owner",
  });
  document.deleteIn(["metadata", "description"]);
  output = await runUpdate(
    capabilityOf("tool", "package-metadata"),
    output.withNewFile(CATALOG_FILE, document.toString()),
  );
  expect(await manifest(output)).not.toHaveProperty("description");
  expect(
    await runUpdate(capabilityOf("tool", "package-metadata"), output),
  ).toBe(output);
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
    runUpdate(
      capabilityOf("tool", "package-metadata"),
      repository({}, doc.toString()),
    ),
  ).rejects.toThrow(message as string);
});

test("update skips a missing package and rejects missing or malformed sources without inventing metadata", async () => {
  const empty = mockDirectory();
  expect(
    await runUpdate(capabilityOf("forge-app", "package-metadata"), empty),
  ).toBe(empty);
  await expect(
    runUpdate(
      capabilityOf("tool", "package-metadata"),
      mockDirectory(new Map([["package.json", "{}"]])),
    ),
  ).rejects.toThrow("catalog-info.yaml is missing");
  for (const pkg of ["{broken", "null", "[]"]) {
    await expect(
      runUpdate(
        capabilityOf("tool", "package-metadata"),
        repository({}).withNewFile("package.json", pkg),
      ),
    ).rejects.toThrow(ParseError);
  }
  for (const yaml of [
    "metadata: [broken",
    "[]",
    "metadata: {}\nmetadata: {}\n",
  ]) {
    await expect(
      runUpdate(capabilityOf("tool", "package-metadata"), repository({}, yaml)),
    ).rejects.toThrow(ParseError);
  }
});

test("standalone validation accepts owner choices without catalog or policy comparison", async () => {
  const validate = verb(capabilityOf("tool", "package-metadata"), "validate");
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
    expect(await validate(input)).toEqual({
      status: "validated",
    });
    expect(await input.file("package.json").contents()).toBe(contents);
  }
  expect(
    await validate(mockDirectory(new Map([["package.json", "{}"]]))),
  ).toEqual({ status: "validated" });
  expect(await validate(mockDirectory())).toEqual({
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
    await validateCapabilities(input, [
      capabilityOf("forge-app", "package-metadata"),
    ]),
  ).toEqual([
    {
      capability: "package-metadata",
      status: "failed",
      reason: expect.stringContaining(reason),
    },
  ]);
});
