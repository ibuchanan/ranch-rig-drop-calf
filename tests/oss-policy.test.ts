import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import {
  CATALOG_FILE,
  COPYRIGHT_DATE,
  LICENSE,
  renderCatalog,
} from "../src/catalog.ts";
import { DropCalf } from "../src/index.ts";
import { copyOssAssets, OSS_ASSETS, oss } from "../src/oss.ts";
import { resolveProfile } from "../src/profiles.ts";
import { mockDirectory } from "./module-source.ts";
import { mockOssSource, ossTemplates } from "./oss-source.ts";
import { catalogTemplates } from "./templates-source.ts";

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
