import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  expandCapability,
  noOp,
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import { changelogToolchain, validateChangelog } from "../src/changelog.ts";
import { DropCalf } from "../src/index.ts";
import { prelint, validatePrelint } from "../src/prelint.ts";
import { PROFILES, resolveProfile } from "../src/profiles.ts";
import { contents, kinds, selections } from "./capability-fixtures.ts";
import { mockDirectory as tree, mockModuleSource } from "./module-source.ts";

test.each(["", " ", "\n\t"])("no-op rejects an empty reason: %j", (reason) => {
  expect(() => noOp(reason)).toThrow("non-empty reason");
});

test("no-op reasons are enumerable data, including the deliberately inactive init", () => {
  const selected = resolveProfile("agent-skill");
  const reasons = noOpReasons(selected);
  expect(reasons).toContainEqual({
    capability: "test",
    verb: "init",
    reason: "The agent-skill profile does not seed a test runner.",
  });
  expect(reasons.filter((item) => item.verb === "update")).toHaveLength(
    selected.filter((item) => typeof item.update !== "function").length,
  );
  for (const item of reasons) expect(item.reason.trim()).not.toBe("");
  expect(() => JSON.stringify(reasons)).not.toThrow();
});

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
