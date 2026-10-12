import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { aidev } from "../src/aidev.ts";
import { noOpReasons, validateCapabilities } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { applyPreclean } from "../src/preclean.ts";
import {
  buildProject,
  InvalidOptionsError,
  resolveProfile,
} from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];

const updateReason =
  "Agent guidance is init-only and owner-managed; update preserves edits and does not restore a deleted AGENTS.md.";
const validateReason =
  "AGENTS.md is human guidance, not consuming-tool configuration; checking referenced scripts would check guidance policy, not tool acceptance.";

test.each(kinds)(
  "%s guidance has deliberate verbs and owns only its seed",
  (kind) => {
    const capability = aidev(kind);
    expect(
      resolveProfile(kind).filter((item) => item.name === "aidev"),
    ).toHaveLength(1);
    const project = createBlueprint("sample", "", "tester");
    const before = structuredClone(project);
    if (typeof capability.init === "function") capability.init(project);
    expect(project.packageJson).toEqual(before.packageJson);
    expect(project.templates.map((template) => template.path)).toEqual(
      before.templates.map((template) => template.path),
    );
    expect([...project.files.keys()]).toEqual(
      kind === "forge-app" ? ["AGENTS.md"] : [],
    );
    expect(noOpReasons([capability])).toEqual([
      ...(kind === "forge-app"
        ? []
        : [
            {
              capability: "aidev",
              verb: "init" as const,
              reason:
                "Only Forge apps have an authored agent guidance seed; other project kinds omit Forge-specific instructions.",
            },
          ]),
      { capability: "aidev", verb: "update", reason: updateReason },
      { capability: "aidev", verb: "validate", reason: validateReason },
    ]);
  },
);

test.each([undefined, "all"])(
  "Forge init seeds guidance and update preserves edits and deletions with preset %s",
  async (preset) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      for (const without of [[], ["aidev"]]) {
        const initialized = await module.init(
          mockDirectory(),
          "forge-app",
          "tester",
          "sample",
          "",
          "",
          [],
          without,
          preset,
        );
        expect(await initialized.exists("AGENTS.md")).toBe(
          !without.includes("aidev"),
        );
        if (!without.includes("aidev")) {
          expect(await initialized.file("AGENTS.md").contents()).toBe(
            buildProject("forge-app", "sample", "tester").files.get(
              "AGENTS.md",
            ) ?? "",
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
            await module.update(repository, "forge-app", [], without, preset),
          ).toBe(repository);
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
    expect(await validateCapabilities(input, [aidev(kind)])).toEqual([
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
    if (kind === "forge-app") {
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

test("Forge generation includes authored agent guidance for Forge work", () => {
  const guidance = buildProject("forge-app", "sample", "tester").files.get(
    "AGENTS.md",
  );
  expect(guidance).toContain("manifest.yml");
  expect(guidance).toContain("Forge");
  expect(guidance).toContain("npm run typecheck");
});

test("authored guidance stays inside the line length lint:docs enforces", () => {
  // `lint:docs` globs `**/*.md`, so this Markdown is linted too and has to
  // survive MD013 without being a seeded file the docs tree can wrap.
  const guidance = buildProject("forge-app", "sample", "tester").files.get(
    "AGENTS.md",
  ) as string;
  expect(
    guidance
      .split("\n")
      .map((line, index) => [index + 1, line.length] as const)
      .filter(([, length]) => length > 80),
  ).toEqual([]);
});

test("excluding aidev prevents Forge guidance generation", () => {
  const without = ["aidev"];
  expect(
    buildProject(
      "forge-app",
      "sample",
      "tester",
      "",
      "",
      [],
      without,
    ).files.has("AGENTS.md"),
  ).toBe(false);
  expect(() =>
    buildProject("forge-app", "sample", "tester", "", "", ["aidev"], without),
  ).toThrow(InvalidOptionsError);
  expect(() =>
    buildProject("library", "sample", "tester", "", "", [], without),
  ).toThrow(InvalidOptionsError);
});

test("non-Forge kinds omit Forge-specific guidance", () => {
  for (const kind of ["library", "tool", "agent-skill"])
    expect(buildProject(kind, "sample", "tester").files.has("AGENTS.md")).toBe(
      false,
    );
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
