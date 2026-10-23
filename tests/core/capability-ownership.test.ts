import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  buildProject,
  PROFILES,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { type Capability, noOpReasons } from "../../src/core/capability.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";
import { outputOwners, packageOutputs } from "../support/ownership-ledger.ts";

const kinds = Object.keys(PROFILES);
test.each(kinds)(
  "%s has exactly one capability owner for every file and package output",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      for (const preset of [undefined, "all"]) {
        const selected = resolveProfile(kind, [], [], preset);
        const { owners, directory } = await outputOwners(selected, kind);
        for (const [path, names] of owners)
          expect(
            names.size,
            `${kind}: ${path} is owned by ${[...names].join(", ")}`,
          ).toBe(1);
        const initialized = await new DropCalf().init(
          mockDirectory(),
          kind,
          "tester",
          "sample",
          "A sample project",
          [],
          [],
          preset,
        );
        for (const path of (
          initialized as ReturnType<typeof mockDirectory>
        ).files.keys()) {
          if (path === "package.json") {
            for (const field of packageOutputs(
              JSON.parse(await initialized.file(path).contents()),
            ).keys())
              expect(owners.has(field), `${kind}: unowned ${field}`).toBe(true);
          } else
            expect(owners.has(path), `${kind}: unowned ${path}`).toBe(true);
        }
        expect(await directory.exists("catalog-info.yaml")).toBe(true);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("ownership checks detect two capabilities writing the same output even with identical seeds", async () => {
  const seed = (name: string): Capability => ({
    name,
    documentation: { tools: [] },
    packageJson: { policy: { scripts: { duplicate: "same" } } },
    init(project) {
      project.files.set("duplicate.txt", "same");
    },
    update: { reason: "No update policy." },
    validate: { reason: "No consuming tool." },
  });
  const { owners } = await outputOwners(
    [seed("first"), seed("second")],
    "tool",
  );
  expect([...(owners.get("duplicate.txt") ?? [])]).toEqual(["first", "second"]);
  expect([...(owners.get("package.json#scripts.duplicate") ?? [])]).toEqual([
    "first",
    "second",
  ]);
});

test("ownership checks detect updaters enforcing the same package values", async () => {
  const update = (name: string): Capability => ({
    name,
    documentation: { tools: [] },
    init: { reason: "There is no init seed." },
    async update(directory) {
      const pkg = JSON.parse(await directory.file("package.json").contents());
      pkg.scripts.shared = "same";
      pkg.devDependencies.shared = "same";
      return directory.withNewFile("package.json", JSON.stringify(pkg));
    },
    validate: { reason: "There is no consuming configuration." },
  });
  const { owners } = await outputOwners(
    [update("first"), update("second")],
    "tool",
  );
  for (const path of [
    "package.json#scripts.shared",
    "package.json#devDependencies.shared",
  ])
    expect([...(owners.get(path) ?? [])]).toEqual(["first", "second"]);
});

test("every selected capability has deliberate verbs with no migration placeholders", () => {
  for (const [kind, capabilities] of Object.entries(PROFILES)) {
    expect(new Set(capabilities.map(({ name }) => name)).size).toBe(
      capabilities.length,
    );
    for (const capability of capabilities) {
      expect(capability).not.toHaveProperty("addTo");
      expect(capability).not.toHaveProperty("templates");
      for (const verb of ["init", "update", "validate"] as const) {
        const operation = capability[verb];
        expect(operation, `${kind}/${capability.name}.${verb}`).toBeDefined();
        if (typeof operation !== "function")
          expect(operation.reason.trim()).not.toBe("");
      }
    }
    for (const entry of noOpReasons(capabilities))
      expect(
        entry.reason,
        `${kind}/${entry.capability}.${entry.verb}`,
      ).not.toMatch(/deferred|ticket\s+\d|placeholder|not yet implemented/i);
    expect(buildProject(kind, "sample", "tester").files.has("README.md")).toBe(
      false,
    );
  }
  expect(
    Object.getOwnPropertyNames(DropCalf.prototype).some((name) =>
      name.startsWith("copy"),
    ),
  ).toBe(false);
});
