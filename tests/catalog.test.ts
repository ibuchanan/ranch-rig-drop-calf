import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { parse, parseDocument } from "yaml";
import {
  CATALOG_FILE,
  CATALOG_TEMPLATE,
  COPYRIGHT_DATE,
  PACKAGE_NAME,
  catalog,
  renderCatalog,
  validateCatalog,
} from "../src/catalog.ts";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject, PROFILES } from "../src/profiles.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { catalogTemplates } from "./templates-source.ts";

const template = catalogTemplates().get(CATALOG_FILE) ?? "";
const seeded = (overrides = {}) =>
  renderCatalog(template, {
    name: "example",
    owner: "tester",
    type: "library",
    copyrightDate: "2024",
    ...overrides,
  });

// Minimal immutable directory: validators cannot write to it or require package.json.
function repository(contents?: string) {
  return {
    exists: async (path: string) =>
      contents !== undefined && path === CATALOG_FILE,
    file: (path: string) => {
      if (path !== CATALOG_FILE || contents === undefined)
        throw new Error(`Unexpected read: ${path}`);
      return { contents: async () => contents };
    },
  } as unknown as Directory;
}

async function result(contents: string) {
  return (await validateCapabilities(repository(contents), [catalog()]))[0];
}

test.each(Object.keys(PROFILES))(
  "%s declares the catalog seed without authoring YAML",
  (kind) => {
    const project = buildProject(
      kind,
      "example",
      "tester",
      "Description",
      "An author",
    );
    expect(project.templates).toContain(CATALOG_TEMPLATE);
    expect(project.files.has(CATALOG_FILE)).toBe(false);
  },
);

test("the file seed defines defaults and optional external-system examples", () => {
  const output = seeded({
    name: "@Scope/My.Project",
    description: "A project",
    type: "python-library",
  });
  expect(parse(output)).toEqual({
    apiVersion: "backstage.io/v1alpha1",
    kind: "Component",
    metadata: {
      name: "scope-my.project",
      title: "@Scope/My.Project",
      description: "A project",
      annotations: {
        [PACKAGE_NAME]: "@Scope/My.Project",
        [COPYRIGHT_DATE]: "2024",
      },
    },
    spec: {
      type: "python-library",
      lifecycle: "experimental",
      owner: "user:default/tester",
    },
  });
  expect(output).toContain("# github.com/project-slug:");
  expect(output).toContain("# jira/project-key:");
  expect(output).not.toContain("[Catalog name]");
});

test("editable seed defaults, comments, and additions survive rendering", () => {
  const custom = template
    .replace("experimental", "production")
    .replace(
      "  annotations:",
      "  labels:\n    example.com/language: python\n  annotations:",
    );
  const output = renderCatalog(custom, {
    name: "example",
    owner: "tester",
    type: "service",
  });
  expect(parse(output).spec.lifecycle).toBe("production");
  expect(parse(output).metadata.labels["example.com/language"]).toBe("python");
  expect(parse(output).metadata.annotations[COPYRIGHT_DATE]).toBe(
    String(new Date().getFullYear()),
  );
  expect(output).toContain("# A single year or inclusive range");
});

test("seed values remain YAML data, including multiline strings and token-like input", async () => {
  const name = 'A "project": # example\nnext';
  const description = '[Owner]\ntext: "quoted"';
  const output = seeded({ name, description });
  expect(parse(output).metadata.title).toBe(name);
  expect(parse(output).metadata.description).toBe(description);
  expect(await validateCatalog(repository(output))).toEqual({
    status: "validated",
  });
});

test("catalog identifiers have alphanumeric ends and bounded length", () => {
  const output = seeded({ name: `--${"X".repeat(62)}--tail__` });
  const name = parse(output).metadata.name;
  expect(name).toBe("x".repeat(62));
  expect(name.length).toBeLessThanOrEqual(63);
  expect(() => seeded({ name: "@/___" })).toThrow("letter or digit");
});

test("catalog update is explicitly inactive and leaves both present and missing files alone", async () => {
  expect(noOpReasons([catalog()])).toEqual([
    {
      capability: "catalog",
      verb: "update",
      reason: "Catalog owns the file, but no update policy is defined.",
    },
  ]);
  for (const input of [repository(), repository("invalid: [yaml")]) {
    expect(await updateCapabilities(input, [catalog()])).toBe(input);
  }
});

test("missing catalog validation is skipped, not accepted or bootstrapped", async () => {
  expect(await validateCatalog(repository())).toEqual({
    status: "skipped",
    reason: "catalog-info.yaml is missing",
  });
});

test.each(["2024", "2024-2026", "2024-2024"])(
  "structurally validates copyright date %s without package metadata",
  async (copyrightDate) => {
    expect(await result(seeded({ copyrightDate }))).toEqual({
      capability: "catalog",
      status: "validated",
    });
  },
);

test("accepts owner-edited metadata without enforcing defaults or checking remote references", async () => {
  const document = parseDocument(seeded());
  document.setIn(["spec", "lifecycle"], "production");
  document.setIn(["spec", "type"], "unlisted-type");
  document.setIn(["spec", "owner"], "user:another-namespace/someone-else");
  document.setIn(
    ["metadata", "annotations", "github.com/project-slug"],
    "unregistered/repository",
  );
  document.setIn(
    ["metadata", "links"],
    [{ url: "https://example.atlassian.net/browse/EXAMPLE", title: "Jira" }],
  );
  expect(await result(document.toString())).toEqual({
    capability: "catalog",
    status: "validated",
  });
});

test("forge-ranch annotations persist as shared metadata for other modules", async () => {
  expect(PACKAGE_NAME).toBe("forge-ranch/package-name");
  expect(COPYRIGHT_DATE).toBe("forge-ranch/copyright-date");
  const document = parseDocument(seeded());
  document.setIn(
    ["metadata", "annotations", "forge-ranch/module-setting"],
    "an owner-edited value",
  );
  const contents = document.toString();
  const input = mockDirectory(new Map([[CATALOG_FILE, contents]]));
  const output = await updateCapabilities(input, [catalog()]);
  expect(await output.file(CATALOG_FILE).contents()).toBe(contents);
  expect(await validateCatalog(output)).toEqual({ status: "validated" });
  expect(
    parse(contents).metadata.annotations["forge-ranch/module-setting"],
  ).toBe("an owner-edited value");
});

test("copyright annotation is optional for structural acceptance", async () => {
  const document = parseDocument(seeded());
  document.deleteIn(["metadata", "annotations", COPYRIGHT_DATE]);
  expect(await result(document.toString())).toEqual({
    capability: "catalog",
    status: "validated",
  });
});

test.each([
  ["broken YAML", "metadata: [broken\n"],
  ["duplicate keys", "kind: Component\nkind: Component\n"],
  ["multiple entities", `${seeded()}---\n${seeded()}`],
  ["empty document", ""],
  ["non-mapping", "- Component\n"],
  ["missing lifecycle", seeded().replace("  lifecycle: experimental\n", "")],
  ["missing owner", seeded().replace('  owner: "user:default/tester"\n', "")],
  [
    "group owner",
    seeded().replace("user:default/tester", "group:default/tester"),
  ],
  [
    "malformed user reference",
    seeded().replace("user:default/tester", "user:default/a/b"),
  ],
  ["missing name", seeded().replace('  name: "example"\n', "")],
  ["invalid name", seeded().replace('  name: "example"', '  name: "bad/name"')],
  ["foreign root field", `${seeded()}copyright: 2024\n`],
  ["numeric annotation", seeded().replace('"2024"', "2024")],
  ["wrong kind", seeded().replace("kind: Component", "kind: System")],
  ["invalid year", seeded({ copyrightDate: "24" })],
  ["reversed range", seeded({ copyrightDate: "2026-2024" })],
])("reports %s as a structural failure", async (_label, contents) => {
  expect(await result(contents)).toMatchObject({
    capability: "catalog",
    status: "failed",
    reason: expect.any(String),
  });
});

test.each(Object.keys(PROFILES))(
  "%s init seeds a valid catalog from the real module template",
  async (profile) => {
    const source = mockModuleSource();
    const directory = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const output = await new DropCalf().init(
        mockDirectory(),
        profile,
        "tester",
        "@scope/example",
        "A description",
        "",
        [],
        [],
        "all",
      );
      expect(await validateCatalog(output)).toEqual({ status: "validated" });
      const entity = parse(await output.file(CATALOG_FILE).contents());
      expect(entity.spec.type).toBe(profile);
      expect(entity.spec.owner).toBe("user:default/tester");
      expect(entity.metadata.title).toBe("@scope/example");
      expect(entity.metadata.description).toBe("A description");
    } finally {
      directory.mockRestore();
      source.mockRestore();
    }
  },
);

test("standalone catalog functions work without package.json or a current project kind", async () => {
  const source = mockModuleSource();
  try {
    const module = new DropCalf();
    const output = await module.copyCatalog(
      mockDirectory(),
      "python-project",
      "tester",
      "python-library",
      "",
      "2020-2024",
    );
    expect(await output.exists("package.json")).toBe(false);
    expect(JSON.parse(await module.validateCatalog(output))).toEqual({
      status: "validated",
    });
    expect(
      parse(await output.file(CATALOG_FILE).contents()).metadata.annotations[
        COPYRIGHT_DATE
      ],
    ).toBe("2020-2024");
  } finally {
    source.mockRestore();
  }
});
