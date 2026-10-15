import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  AIDEV_TEMPLATE,
  LIBRARY_AIDEV_TEMPLATE,
} from "../../src/capabilities/aidev.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { applyPreclean } from "../../src/composition/scaffold.ts";
import {
  noOpReasons,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { InvalidOptionsError } from "../../src/core/errors.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { seedTemplates } from "../../src/core/templates.ts";
import { DropCalf } from "../../src/index.ts";
import { capabilityOf, runInit } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { aidevTemplates } from "../support/templates-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];

const updateReason =
  "Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md.";
const validateReason =
  "AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance.";

test.each(kinds)(
  "%s guidance has deliberate verbs and owns only its seed",
  (kind) => {
    const capability = capabilityOf(kind, "aidev");
    expect(
      resolveProfile(kind).filter((item) => item.name === "aidev"),
    ).toHaveLength(1);
    const project = createBlueprint("sample", "", "tester");
    const before = structuredClone(project);
    runInit(capability, project);
    expect(project.packageJson).toEqual(before.packageJson);
    const expectedTemplate =
      kind === "forge-app"
        ? AIDEV_TEMPLATE
        : kind === "library"
          ? LIBRARY_AIDEV_TEMPLATE
          : null;
    expect(project.templates.map((template) => template.path)).toEqual(
      expectedTemplate ? [expectedTemplate] : [],
    );
    expect(project.files).toEqual(before.files);
    expect(noOpReasons([capability])).toEqual([
      ...(["forge-app", "library"].includes(kind)
        ? []
        : [
            {
              capability: "aidev",
              verb: "init" as const,
              reason:
                "No authored agent guidance is selected for this project kind.",
            },
          ]),
      { capability: "aidev", verb: "update", reason: updateReason },
      { capability: "aidev", verb: "validate", reason: validateReason },
    ]);
  },
);

test.each(
  ["forge-app", "library"].flatMap((kind) =>
    [undefined, "all"].map((preset) => ({ kind, preset })),
  ),
)(
  "$kind init seeds guidance and update preserves edits and deletions ($preset)",
  async ({ kind, preset }) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      for (const without of [[], ["aidev"]]) {
        const initialized = await module.init(
          mockDirectory(),
          kind,
          "tester",
          "sample",
          "",
          [],
          without,
          preset,
        );
        expect(await initialized.exists("AGENTS.md")).toBe(
          !without.includes("aidev"),
        );
        expect(await initialized.exists("evals.md")).toBe(false);
        if (!without.includes("aidev")) {
          expect(await initialized.file("AGENTS.md").contents()).toBe(
            (aidevTemplates(kind as "forge-app" | "library").get("AGENTS.md") ??
              "") +
              (kind === "forge-app" && preset === "all"
                ? aidevTemplates().get("evals.md")
                : ""),
          );
        }
        for (const repository of [
          initialized.withNewFile(
            "AGENTS.md",
            "# Owner guidance\nKeep my changes.\n",
          ),
          initialized.withoutFile("AGENTS.md"),
        ]) {
          expect(
            await module.update(repository, kind, [], without, preset),
          ).toBe(repository);
          for (const nextPreset of [undefined, "all"]) {
            const updated = await module.update(
              repository,
              kind,
              [],
              without,
              nextPreset,
            );
            expect(await updated.exists("AGENTS.md")).toBe(
              await repository.exists("AGENTS.md"),
            );
            if (await repository.exists("AGENTS.md"))
              expect(await updated.file("AGENTS.md").contents()).toBe(
                await repository.file("AGENTS.md").contents(),
              );
          }
        }
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test.each(kinds)(
  "%s guidance validation is a read-only skip without script checks",
  async (kind) => {
    const input = mockDirectory(
      new Map([
        ["AGENTS.md", "Run a script that does not exist.\n"],
        ["package.json", '{"scripts":{}}'],
      ]),
    );
    const before = [...input.files];
    expect(
      await validateCapabilities(input, [capabilityOf(kind, "aidev")]),
    ).toEqual([
      { capability: "aidev", status: "skipped", reason: validateReason },
    ]);
    const module = new DropCalf();
    const report = JSON.parse(await module.validate(input, kind));
    expect(
      report.filter(
        (item: { capability: string }) => item.capability === "aidev",
      ),
    ).toEqual([
      { capability: "aidev", status: "skipped", reason: validateReason },
    ]);
    if (kind === "forge-app" || kind === "library") {
      expect(
        resolveProfile(kind, [], ["aidev"]).some(
          (item) => item.name === "aidev",
        ),
      ).toBe(false);
      const excluded = JSON.parse(
        await module.validate(input, kind, [], ["aidev"]),
      );
      expect(
        excluded.some(
          (item: { capability: string }) => item.capability === "aidev",
        ),
      ).toBe(false);
    }
    expect([...input.files]).toEqual(before);
  },
);

test.each([
  {
    name: "default",
    withFunctions: [],
    withoutFunctions: [],
    preset: undefined,
    evals: false,
  },
  {
    name: "with evals",
    withFunctions: ["evals"],
    withoutFunctions: [],
    preset: undefined,
    evals: true,
  },
  {
    name: "without evals",
    withFunctions: [],
    withoutFunctions: ["evals"],
    preset: undefined,
    evals: false,
  },
  {
    name: "all",
    withFunctions: [],
    withoutFunctions: [],
    preset: "all",
    evals: true,
  },
  {
    name: "all without evals",
    withFunctions: [],
    withoutFunctions: ["evals"],
    preset: "all",
    evals: false,
  },
])(
  "Forge guidance references initialized scripts and files: $name",
  async (selection) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const initialized = await new DropCalf().init(
        mockDirectory(
          new Map([
            [
              "manifest.yml",
              "app:\n  id: ari:cloud:ecosystem::app/example\n  runtime:\n    name: nodejs24.x\nmodules:\n  function: []\n",
            ],
          ]),
        ),
        "forge-app",
        "tester",
        "sample",
        "",
        [...selection.withFunctions],
        [...selection.withoutFunctions],
        selection.preset,
      );
      const guidance = await initialized.file("AGENTS.md").contents();
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      const references = [...guidance.matchAll(/`([^`]+)`/g)].map(
        (match) => match[1] as string,
      );
      const scripts = references
        .filter((reference) => reference.startsWith("npm run "))
        .map((reference) => reference.slice("npm run ".length));
      expect(scripts).toContain("check");
      for (const script of scripts)
        expect(
          pkg.scripts[script],
          `Missing guidance script: ${script}`,
        ).toBeString();
      const paths = references.filter((reference) =>
        /\.(md|yml|yaml|json)$/.test(reference),
      );
      expect(paths).toContain("manifest.yml");
      for (const path of paths)
        expect(
          await initialized.exists(path),
          `Missing guidance file: ${path}`,
        ).toBe(true);
      expect(pkg.scripts.test).toBe("vitest run --passWithNoTests");
      expect(guidance.includes("## Prompt evaluations")).toBe(selection.evals);
      expect(scripts.includes("eval")).toBe(selection.evals);
      expect(scripts.includes("view")).toBe(selection.evals);
      expect(guidance).not.toMatch(
        /`forge (?:deploy|install|tunnel|logs|lint|register)/,
      );
      for (const stale of [
        "npm run types`",
        "bun test",
        "forge:tunnel",
        "forge:logs",
        "architecture tests",
        "trigger starters",
      ])
        expect(guidance).not.toContain(stale);
      if (selection.evals) {
        expect(await initialized.exists("promptfooconfig.yaml")).toBe(true);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("a promptfoo dependency alone does not select eval guidance", async () => {
  const source = mockModuleSource();
  try {
    const project = createBlueprint("sample", "", "tester");
    project.packageJson.devDependencies.promptfoo = "owner";
    runInit(capabilityOf("forge-app", "aidev"), project);
    const seeded = await seedTemplates(
      mockDirectory(),
      dag.currentModule().source(),
      project.templates,
    );
    expect(await seeded.file("AGENTS.md").contents()).toBe(
      aidevTemplates("forge-app").get("AGENTS.md") ?? "",
    );
  } finally {
    source.mockRestore();
  }
});

test.each([undefined, "all"])(
  "authored guidance stays inside the docs line length with preset %s",
  (preset) => {
    // `lint:docs` globs `**/*.md`, including this seed, and enforces MD013.
    const templates = aidevTemplates("forge-app");
    const guidance =
      (templates.get("AGENTS.md") ?? "") +
      (preset === "all" ? templates.get("evals.md") : "");
    expect(
      guidance
        .split("\n")
        .map((line, index) => [index + 1, line.length] as const)
        .filter(([, length]) => length > 80),
    ).toEqual([]);
  },
);

test.each(["forge-app", "library"])(
  "excluding aidev prevents %s guidance generation",
  (kind) => {
    const without = ["aidev"];
    expect(
      buildProject(kind, "sample", "tester", "", [], without).templates.map(
        (template) => template.path,
      ),
    ).not.toContain(
      kind === "library" ? LIBRARY_AIDEV_TEMPLATE : AIDEV_TEMPLATE,
    );
    expect(() =>
      buildProject(kind, "sample", "tester", "", ["aidev"], without),
    ).toThrow(InvalidOptionsError);
    for (const unsupported of ["tool", "agent-skill"])
      expect(() =>
        buildProject(unsupported, "sample", "tester", "", [], without),
      ).toThrow(InvalidOptionsError);
  },
);

test("library guidance names compatibility constraints without app assumptions", () => {
  const guidance = aidevTemplates("library").get("AGENTS.md") ?? "";
  expect(guidance).toContain("Node.js 22");
  expect(guidance).toContain("ESM and CommonJS");
  expect(guidance).toContain("TypeScript declarations");
  expect(guidance).toContain(
    "Do not publish packages without explicit approval",
  );
  expect(guidance).not.toMatch(
    /manifest|forge deploy|storage|## Prompt evaluations/i,
  );
  expect(guidance.split("\n").filter((line) => line.length > 80)).toEqual([]);
});

test("non-Forge kinds omit Forge-specific guidance", () => {
  for (const kind of ["library", "tool", "agent-skill"])
    expect(
      buildProject(kind, "sample", "tester").templates.map(
        (template) => template.path,
      ),
    ).not.toContain(AIDEV_TEMPLATE);
});

test("explicit Forge preclean removes scaffold guidance so generated guidance can replace it", async () => {
  const scaffold = new Map([
    [
      "manifest.yml",
      "app:\n  id: ari:cloud:ecosystem::app/example\nmodules:\n  function: []\n",
    ],
    [
      "package.json",
      '{"name":"example","scripts":{"lint":"eslint ."},"dependencies":{"@forge/api":"^7.0.0"}}',
    ],
    ["AGENTS.md", "# Forge starter guidance\n"],
  ]);
  const directory = (files: Map<string, string>) => ({
    files,
    exists: async (path: string) => files.has(path),
    withoutFile: (path: string) => {
      const next = new Map(files);
      next.delete(path);
      return directory(next);
    },
    file: (path: string) => ({
      contents: async () => files.get(path) as string,
    }),
    withNewFile: (path: string, contents: string) => {
      const next = new Map(files);
      next.set(path, contents);
      return directory(next);
    },
  });
  const cleaned = (
    (await applyPreclean(directory(scaffold) as never)) as unknown as {
      files: Map<string, string>;
    }
  ).files;
  expect(cleaned.has("AGENTS.md")).toBe(false);
});
