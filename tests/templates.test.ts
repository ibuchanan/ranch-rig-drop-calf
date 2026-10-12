import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { BIOME_TEMPLATE } from "../src/biome.ts";
import { type Capability, noOp } from "../src/capability.ts";
import { CATALOG_TEMPLATE } from "../src/catalog.ts";
import { CHANGELOG_TEMPLATE } from "../src/changelog.ts";
import { DOCS_TEMPLATE } from "../src/docs.ts";
import { EVALS_TEMPLATE } from "../src/evals.ts";
import { GIT_HOOKS_TEMPLATE } from "../src/git-hooks.ts";
import { PINNED_GITIGNORE } from "../src/gitignore.ts";
import { LIBRARY_BUILD_TEMPLATE } from "../src/library-build.ts";
import { PINNED_OSS } from "../src/oss.ts";
import { buildProject, PROFILES } from "../src/profiles.ts";
import { SECRETS_TEMPLATE } from "../src/secrets.ts";
import { seedTemplates, templateTree } from "../src/templates.ts";
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
    expect(project.templates.map((template) => template.path).sort()).toEqual(
      [
        BIOME_TEMPLATE,
        CATALOG_TEMPLATE,
        PINNED_OSS,
        PINNED_GITIGNORE,
        ...(kind === "agent-skill" ? [] : [CHANGELOG_TEMPLATE]),
        DOCS_TEMPLATE,
        GIT_HOOKS_TEMPLATE,
        ...(kind === "library" ? [LIBRARY_BUILD_TEMPLATE] : []),
        ...(kind === "forge-app" ? [SECRETS_TEMPLATE, "templates/vitest"] : []),
        ...(kind === "forge-app" && preset === "all" ? [EVALS_TEMPLATE] : []),
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
    {
      name: "custom-empty",
      documentation: { tools: [] },
      init: noOp("No seed is needed."),
      update: noOp("No outputs to maintain."),
      validate: noOp("No consuming configuration."),
    },
    {
      name: "custom-trees",
      documentation: { tools: [] },
      init(project) {
        project.templates.push(
          templateTree("custom/first"),
          templateTree("custom/second"),
        );
      },
      update: noOp("Owner-managed templates."),
      validate: noOp("No consuming configuration."),
    },
  ];
  const before = buildProject("tool", "sample", "tester").templates.map(
    (template) => template.path,
  );
  capabilities.push(...added);
  try {
    const project = buildProject("tool", "sample", "tester");
    expect(project.templates.map((template) => template.path)).toEqual([
      ...before,
      "custom/first",
      "custom/second",
    ]);
    expect(project.files.has("custom/first")).toBe(false);
  } finally {
    capabilities.splice(-added.length);
  }
  expect(
    buildProject("tool", "sample", "tester").templates.map(
      (template) => template.path,
    ),
  ).toEqual(before);
});

test("seeding awaits custom capability steps and threads their results in order", async () => {
  const first = {} as Directory;
  const second = {} as Directory;
  const source = {} as Directory;
  const calls: string[] = [];
  expect(
    await seedTemplates(first, source, [
      {
        path: "custom/file",
        async seed(input, moduleSource) {
          await Promise.resolve();
          expect(input).toBe(first);
          expect(moduleSource).toBe(source);
          calls.push("first");
          return second;
        },
      },
      {
        path: "custom/tree",
        seed(input) {
          expect(input).toBe(second);
          calls.push("second");
          return input;
        },
      },
    ]),
  ).toBe(second);
  expect(calls).toEqual(["first", "second"]);
  await expect(
    seedTemplates(first, source, [
      {
        path: "bad",
        seed() {
          throw new Error("seed failed");
        },
      },
    ]),
  ).rejects.toThrow("seed failed");
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
  expect(await seedTemplates(destination, source, [])).toBe(destination);
  expect(requested).toEqual([]);
  expect(copied).toEqual([]);
  expect(
    await seedTemplates(destination, source, [
      templateTree("custom/first"),
      templateTree("custom/second"),
    ]),
  ).toBe(destination);
  expect(requested).toEqual(["custom/first", "custom/second"]);
  expect(copied).toEqual([first, second]);
});
