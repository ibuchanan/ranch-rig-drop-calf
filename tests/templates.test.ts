import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { BIOME_TEMPLATE } from "../src/biome.ts";
import type { Capability } from "../src/capabilities.ts";
import { CHANGELOG_TEMPLATE } from "../src/changelog.ts";
import { DOCS_TEMPLATE } from "../src/docs.ts";
import { GIT_HOOKS_TEMPLATE } from "../src/git-hooks.ts";
import { buildProject, PROFILES } from "../src/profiles.ts";
import { SECRETS_TEMPLATE } from "../src/secrets.ts";
import { seedTemplates } from "../src/templates.ts";
import { TYPESCRIPT_TEMPLATE } from "../src/typescript.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];

test.each(kinds)("%s declares only its selected template trees", (kind) => {
  for (const preset of [undefined, "all"]) {
    const project = buildProject(
      kind,
      "sample",
      "tester",
      "",
      "",
      [],
      [],
      preset,
    );
    expect([...project.templates].sort()).toEqual(
      [
        BIOME_TEMPLATE,
        ...(kind === "agent-skill" ? [] : [CHANGELOG_TEMPLATE]),
        DOCS_TEMPLATE,
        GIT_HOOKS_TEMPLATE,
        ...(kind === "forge-app" ? [SECRETS_TEMPLATE] : []),
        TYPESCRIPT_TEMPLATE,
      ].sort(),
    );
  }
});

test.each(kinds)(
  "%s leaves Biome and EditorConfig authorship to the pinned template",
  (kind) => {
    const project = buildProject(kind, "sample", "tester");
    expect(project.files.has("biome.jsonc")).toBe(false);
    expect(project.files.has("biome.json")).toBe(false);
    expect(project.files.has(".editorconfig")).toBe(false);
  },
);

test("assembly collects zero or multiple trees from capabilities without reading them", () => {
  const capabilities = PROFILES.tool;
  if (!capabilities) throw new Error("tool profile is missing");
  const added: Capability[] = [
    { addTo() {} },
    { templates: ["custom/first", "custom/second"], addTo() {} },
  ];
  const before = buildProject("tool", "sample", "tester").templates;
  capabilities.push(...added);
  try {
    const project = buildProject("tool", "sample", "tester");
    expect(project.templates).toEqual([
      ...before,
      "custom/first",
      "custom/second",
    ]);
    expect(project.files.has("custom/first")).toBe(false);
  } finally {
    capabilities.splice(-added.length);
  }
  expect(buildProject("tool", "sample", "tester").templates).toEqual(before);
});

test("seeding overlays every declared tree, or does nothing with no trees", async () => {
  const requested: string[] = [];
  const copied: Directory[] = [];
  const first = {} as Directory;
  const second = {} as Directory;
  const source = {
    directory(path: string) {
      requested.push(path);
      return path === "custom/first" ? first : second;
    },
  } as unknown as Directory;
  const destination = {
    withDirectory(path: string, tree: Directory) {
      expect(path).toBe(".");
      copied.push(tree);
      return destination;
    },
  } as unknown as Directory;
  expect(await seedTemplates(destination, source, [], "sample")).toBe(
    destination,
  );
  expect(requested).toEqual([]);
  expect(copied).toEqual([]);
  expect(
    await seedTemplates(
      destination,
      source,
      ["custom/first", "custom/second"],
      "sample",
    ),
  ).toBe(destination);
  expect(requested).toEqual(["custom/first", "custom/second"]);
  expect(copied).toEqual([first, second]);
});
