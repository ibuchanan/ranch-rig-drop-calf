import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { seedAgentGuidance } from "../src/aidev.ts";
import {
  type Capability,
  expandCapability,
  noOp,
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import { changelogToolchain, validateChangelog } from "../src/changelog.ts";
import { evals } from "../src/evals.ts";
import { DropCalf } from "../src/index.ts";
import { prelint, validatePrelint } from "../src/prelint.ts";
import { buildProject, PROFILES, resolveProfile } from "../src/profiles.ts";
import { createBlueprint, renderToDirectory } from "../src/project.ts";
import { seedTemplates } from "../src/templates.ts";
import { mockModuleSource, mockDirectory as tree } from "./module-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];
const selections = (kind: string) => [
  { withFunctions: [], withoutFunctions: [], preset: undefined },
  { withFunctions: [], withoutFunctions: [], preset: "all" },
  ...(kind === "forge-app"
    ? [
        { withFunctions: ["evals"], withoutFunctions: [], preset: undefined },
        { withFunctions: [], withoutFunctions: ["evals"], preset: "all" },
        { withFunctions: [], withoutFunctions: ["aidev"], preset: "all" },
      ]
    : []),
];

const contents = (directory: Directory) =>
  [...(directory as unknown as { files: Map<string, string> }).files].sort(
    ([a], [b]) => a.localeCompare(b),
  );

// The pre-expansion assembly, kept as an independent compatibility oracle.
function legacyProject(
  kind: string,
  withFunctions: string[],
  withoutFunctions: string[],
  preset?: string,
) {
  const project = createBlueprint("sample", "A sample project", "tester");
  const add = (capability: Capability) => {
    capability.addTo(project);
    project.templates.push(...(capability.templates ?? []));
  };
  for (const capability of PROFILES[kind] ?? []) add(capability);
  if (!withoutFunctions.includes("aidev")) seedAgentGuidance(project, kind);
  if (
    kind === "forge-app" &&
    (preset === "all" || withFunctions.includes("evals")) &&
    !withoutFunctions.includes("evals")
  )
    add(evals());
  return project;
}

test.each(["", " ", "\n\t"])("no-op rejects an empty reason: %j", (reason) => {
  expect(() => noOp(reason)).toThrow("non-empty reason");
});

test("no-op reasons are enumerable data, including the deliberately inactive init", () => {
  const selected = resolveProfile("agent-skill");
  const reasons = noOpReasons(selected);
  expect(reasons).toContainEqual({
    capability: "test",
    verb: "init",
    reason:
      "Bun's built-in test runner needs no dependency or configuration seed; update maintains the test scripts, and test sources are owner-managed.",
  });
  expect(reasons.filter((item) => item.verb === "update")).toHaveLength(
    selected.filter((item) => typeof item.update !== "function").length,
  );
  for (const item of reasons) expect(item.reason.trim()).not.toBe("");
  expect(() => JSON.stringify(reasons)).not.toThrow();
});

test.each(kinds)(
  "%s required verbs preserve initialized legacy output and update leaves init unchanged",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() => tree());
    try {
      for (const { withFunctions, withoutFunctions, preset } of selections(
        kind,
      )) {
        const legacy = legacyProject(
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          "Tester",
          withFunctions,
          withoutFunctions,
          preset,
        );
        // Update-only capabilities retain addTo solely for the legacy oracle.
        const legacyInitPackage = structuredClone(legacy.packageJson);
        if (kind !== "forge-app") {
          delete legacyInitPackage.scripts.test;
          delete legacyInitPackage.scripts["test:watch"];
          delete legacyInitPackage.scripts["test:coverage"];
        }
        if (kind === "forge-app") {
          delete legacyInitPackage.devDependencies["@ast-grep/cli"];
          delete legacyInitPackage.devDependencies["@forge-ahead/prelint"];
          delete legacyInitPackage.scripts["lint:prelint"];
          delete legacyInitPackage.scripts["lint:forge"];
        }
        expect(project.packageJson).toEqual(legacyInitPackage);
        expect([...project.files]).toEqual([...legacy.files]);
        expect(project.templates).toEqual(legacy.templates);
        const capabilities = resolveProfile(
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        expect(new Set(capabilities.map((item) => item.name)).size).toBe(
          capabilities.length,
        );
        for (const capability of capabilities) {
          expect(capability.init).toBeDefined();
          expect(capability.update).toBeDefined();
          expect(capability.validate).toBeDefined();
          if (
            [
              "package-metadata",
              "oss",
              "gitignore",
              "node",
              "forge-manifest",
              "changelog",
              "git-hooks",
              "prelint",
              "biome",
              "typescript",
              "library-build",
              "secrets",
              "size-limit",
              "docs",
              "test",
            ].includes(capability.name)
          )
            expect(typeof capability.update).toBe("function");
          else expect(typeof capability.update).not.toBe("function");
        }
        const module = new DropCalf();
        const seeded = await seedTemplates(
          renderToDirectory(legacy),
          dag.currentModule().source(),
          legacy.templates,
          "sample",
          {
            name: "sample",
            owner: "tester",
            type: kind,
            description: "A sample project",
          },
        );
        const generated = await module.update(
          await module.copyGitignore(seeded),
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        const initialized = await module.init(
          tree(),
          kind,
          "tester",
          "sample",
          "A sample project",
          "Tester",
          withFunctions,
          withoutFunctions,
          preset,
        );
        expect(contents(initialized)).toEqual(contents(generated));
        expect(
          await module.update(
            initialized,
            kind,
            withFunctions,
            withoutFunctions,
            preset,
          ),
        ).toBe(initialized);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("standalone validators agree with capability validation results", async () => {
  const changelog = changelogToolchain().validate;
  if (typeof changelog !== "function") throw new Error("missing validator");
  expect(await changelog(tree())).toEqual(await validateChangelog(tree()));
  expect(await validateCapabilities(tree(), [prelint()])).toEqual([
    { capability: "prelint", ...(await validatePrelint(tree())) },
  ]);
});

test("update composes in profile order and passes each result to the next capability", async () => {
  const input = tree();
  const first = expandCapability("first", "test", { addTo() {} });
  const second = expandCapability("second", "test", { addTo() {} });
  first.update = (directory) => directory.withNewFile("first", "done");
  second.update = async (directory) => {
    expect(await directory.file("first").contents()).toBe("done");
    return directory.withNewFile("second", "done");
  };
  const result = await updateCapabilities(input, [first, second]);
  expect(contents(result)).toEqual([
    ["first", "done"],
    ["second", "done"],
  ]);
  expect(contents(input)).toEqual([]);
});

test("validate collects validated, skipped and failed results against the unchanged input", async () => {
  const input = tree(new Map([["owner.txt", "unchanged"]]));
  const before = contents(input);
  const capabilities = [
    expandCapability("passes", "test", { addTo() {} }, async (directory) => {
      expect(directory).toBe(input);
      return { status: "validated" };
    }),
    expandCapability("fails", "test", { addTo() {} }, async (directory) => {
      expect(directory).toBe(input);
      throw new Error("bad tool config");
    }),
    expandCapability(
      "skips",
      "test",
      { addTo() {} },
      noOp("No consuming tool"),
    ),
    expandCapability("missing", "test", { addTo() {} }, async (directory) => {
      expect(directory).toBe(input);
      return { status: "skipped", reason: "config is missing" };
    }),
    expandCapability(
      "also-passes",
      "test",
      { addTo() {} },
      async (directory) => {
        expect(directory).toBe(input);
        return { status: "validated" };
      },
    ),
  ];
  expect(await validateCapabilities(input, capabilities)).toEqual([
    { capability: "passes", status: "validated" },
    { capability: "fails", status: "failed", reason: "bad tool config" },
    { capability: "skips", status: "skipped", reason: "No consuming tool" },
    { capability: "missing", status: "skipped", reason: "config is missing" },
    { capability: "also-passes", status: "validated" },
  ]);
  expect(contents(input)).toEqual(before);
});

test.each(kinds)(
  "%s top-level validate works without init and honors optional selection",
  async (kind) => {
    const input = tree();
    for (const { withFunctions, withoutFunctions, preset } of selections(
      kind,
    )) {
      const report = JSON.parse(
        await new DropCalf().validate(
          input,
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        ),
      );
      expect(
        report.map((item: { capability: string }) => item.capability),
      ).toEqual(
        resolveProfile(kind, withFunctions, withoutFunctions, preset).map(
          (item) => item.name,
        ),
      );
      for (const item of report) {
        expect(item.status).toBe("skipped");
        expect(item.reason.trim()).not.toBe("");
      }
    }
    expect(contents(input)).toEqual([]);
  },
);

test("init runs every update only after templates and scaffold merging are complete", async () => {
  const capabilities = PROFILES.tool;
  if (!capabilities) throw new Error("tool profile is missing");
  const first = expandCapability("first", "test", {
    addTo(project) {
      project.files.set("first.txt", "seeded");
    },
  });
  const second = expandCapability("second", "test", {
    addTo(project) {
      project.files.set("second.txt", "seeded");
    },
  });
  first.update = async (directory) => {
    expect(await directory.file("second.txt").contents()).toBe("seeded");
    expect(await directory.exists("biome.jsonc")).toBe(true);
    expect(await directory.exists("LICENSE")).toBe(true);
    const pkg = JSON.parse(await directory.file("package.json").contents());
    expect(pkg.dependencies.kept).toBe("1.0.0");
    return directory.withNewFile("updated.txt", "first update");
  };
  second.update = async (directory) => {
    expect(await directory.file("updated.txt").contents()).toBe("first update");
    return directory;
  };
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() => tree());
  capabilities.push(first, second);
  try {
    const result = await new DropCalf().init(
      tree(new Map([["package.json", '{"dependencies":{"kept":"1.0.0"}}']])),
      "tool",
      "tester",
      "sample",
    );
    expect(await result.file("updated.txt").contents()).toBe("first update");
  } finally {
    capabilities.splice(-2);
    empty.mockRestore();
    source.mockRestore();
  }
});

test("top-level validate reports a real validator failure and leaves the input untouched", async () => {
  const input = tree(
    new Map([
      ["package.json", "{broken"],
      ["owner.txt", "keep me"],
    ]),
  );
  const before = contents(input);
  const report = JSON.parse(await new DropCalf().validate(input, "forge-app"));
  expect(
    report.find(
      (item: { capability: string }) => item.capability === "package-metadata",
    ),
  ).toMatchObject({
    capability: "package-metadata",
    status: "failed",
  });
  expect(
    report.find(
      (item: { capability: string }) => item.capability === "prelint",
    ),
  ).toEqual({
    capability: "prelint",
    ...(await validatePrelint(input)),
  });
  expect(report).toHaveLength(resolveProfile("forge-app").length);
  expect(report.at(-1).status).toBe("skipped");
  expect(contents(input)).toEqual(before);
});

test("new operations reject invalid selections before reading the input", async () => {
  const module = new DropCalf();
  await expect(module.update({} as Directory, "unknown")).rejects.toThrow(
    "Select a project kind",
  );
  await expect(
    module.validate({} as Directory, "tool", ["evals"]),
  ).rejects.toThrow("only available for forge-app");
  await expect(
    module.update({} as Directory, "forge-app", ["evals"], ["evals"]),
  ).rejects.toThrow("both");
});
