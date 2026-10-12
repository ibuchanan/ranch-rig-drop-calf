import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  type Capability,
  noOp,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import { changelogToolchain, validateChangelog } from "../src/changelog.ts";
import { DropCalf } from "../src/index.ts";
import { prelint, validatePrelint } from "../src/prelint.ts";
import { buildProject, PROFILES, resolveProfile } from "../src/profiles.ts";
import { renderToDirectory } from "../src/project.ts";
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

const inactive = noOp("The test capability has no outputs for this verb.");
const capability = (
  name: string,
  operations: Partial<Capability> = {},
): Capability => ({
  name,
  init: inactive,
  update: inactive,
  validate: inactive,
  ...operations,
});

test.each(kinds)(
  "%s init equals seed-then-update and maintenance is idempotent",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() => tree());
    try {
      for (const selection of selections(kind)) {
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          "",
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        const module = new DropCalf();
        const seeded = await seedTemplates(
          renderToDirectory(project),
          dag.currentModule().source(),
          project.templates,
        );
        const generated = await module.update(
          seeded,
          kind,
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        const initialized = await module.init(
          tree(),
          kind,
          "tester",
          "sample",
          "A sample project",
          "",
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        expect(contents(initialized)).toEqual(contents(generated));
        expect(
          contents(
            await module.update(
              initialized,
              kind,
              selection.withFunctions,
              selection.withoutFunctions,
              selection.preset,
            ),
          ),
        ).toEqual(contents(initialized));
        for (const item of resolveProfile(
          kind,
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        )) {
          expect(item).not.toHaveProperty("addTo");
          expect(item).not.toHaveProperty("templates");
        }
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
  const first = capability("first");
  const second = capability("second");
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
    capability("passes", {
      validate: async (directory) => {
        expect(directory).toBe(input);
        return { status: "validated" };
      },
    }),
    capability("fails", {
      validate: async (directory) => {
        expect(directory).toBe(input);
        throw new Error("bad tool config");
      },
    }),
    capability("skips", { validate: noOp("No consuming tool") }),
    capability("missing", {
      validate: async (directory) => {
        expect(directory).toBe(input);
        return { status: "skipped", reason: "config is missing" };
      },
    }),
    capability("also-passes", {
      validate: async (directory) => {
        expect(directory).toBe(input);
        return { status: "validated" };
      },
    }),
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
  const first = capability("first", {
    init(project) {
      project.files.set("first.txt", "seeded");
    },
  });
  const second = capability("second", {
    init(project) {
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
  ).rejects.toThrow("Cannot select optional function");
  await expect(
    module.update({} as Directory, "forge-app", ["evals"], ["evals"]),
  ).rejects.toThrow("both");
});
