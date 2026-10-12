import { expect, spyOn, test } from "bun:test";
import { type Directory, type File, dag } from "@dagger.io/dagger";
import { type Capability, noOpReasons } from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject, PROFILES, resolveProfile } from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import { seedTemplates } from "../src/templates.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

const kinds = Object.keys(PROFILES);
const packageOutputs = (pkg: Record<string, unknown>): Map<string, unknown> => {
  const outputs = new Map<string, unknown>();
  for (const [key, value] of Object.entries(pkg)) {
    if (["scripts", "dependencies", "devDependencies"].includes(key)) {
      for (const [name, entry] of Object.entries(
        value as Record<string, unknown>,
      ))
        outputs.set(`package.json#${key}.${name}`, entry);
    } else outputs.set(`package.json#${key}`, value);
  }
  return outputs;
};

/** Record actual writes, including same-value init assignments; never copy ownership declarations. */
async function outputOwners(capabilities: Capability[], kind: string) {
  const owners = new Map<string, Set<string>>();
  let owner = "";
  const claim = (path: string) => {
    const claimed = owners.get(path) ?? new Set<string>();
    claimed.add(owner);
    owners.set(path, claimed);
  };
  const trackedPackage = <T extends object>(value: T, prefix = ""): T =>
    new Proxy(value, {
      get(target, key, receiver) {
        const entry = Reflect.get(target, key, receiver);
        return typeof key === "string" &&
          ["scripts", "dependencies", "devDependencies"].includes(key) &&
          entry
          ? trackedPackage(entry, `${key}.`)
          : entry;
      },
      set(target, key, entry, receiver) {
        if (typeof key === "string") {
          if (["scripts", "dependencies", "devDependencies"].includes(key)) {
            for (const name of Object.keys(entry))
              claim(`package.json#${key}.${name}`);
          } else claim(`package.json#${prefix}${key}`);
        }
        return Reflect.set(target, key, entry, receiver);
      },
    });
  const project = createBlueprint("sample", "A sample project", "tester");
  project.packageJson = trackedPackage(project.packageJson);
  const files = project.files;
  project.files = new Proxy(files, {
    get(target, key) {
      if (key === "set")
        return (path: string, contents: string) => {
          claim(path);
          target.set(path, contents);
          return project.files;
        };
      const entry = Reflect.get(target, key, target);
      return typeof entry === "function" ? entry.bind(target) : entry;
    },
  });
  const trackDirectory = (directory: Directory): Directory =>
    new Proxy(directory as ReturnType<typeof mockDirectory>, {
      get(target, key) {
        if (key === "withNewFile")
          return (
            path: string,
            contents: string,
            options?: { permissions?: number },
          ) => {
            if (path === "package.json") {
              const before = packageOutputs(
                JSON.parse(target.files.get(path) ?? "{}"),
              );
              const after = packageOutputs(JSON.parse(contents));
              for (const name of new Set([...before.keys(), ...after.keys()]))
                if (
                  JSON.stringify(before.get(name)) !==
                  JSON.stringify(after.get(name))
                )
                  claim(name);
            } else claim(path);
            return trackDirectory(target.withNewFile(path, contents, options));
          };
        if (key === "withDirectory")
          return (
            _path: string,
            source: Directory & { files: Map<string, string> },
          ) => {
            for (const path of source.files.keys()) claim(path);
            return trackDirectory(target.withDirectory(_path, source));
          };
        if (key === "withFile")
          return (path: string, file: File) => {
            claim(path);
            return trackDirectory(target.withFile(path, file));
          };
        if (key === "withoutFile")
          return (path: string) => {
            claim(path);
            return trackDirectory(target.withoutFile(path));
          };
        const entry = Reflect.get(target, key, target);
        return typeof entry === "function" ? entry.bind(target) : entry;
      },
    }) as Directory;

  for (const capability of capabilities) {
    owner = capability.name;
    if (typeof capability.init === "function") capability.init(project);
  }
  // Start from intentionally stale package identity to observe catalog-derived ownership.
  let directory = trackDirectory(
    mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            ...project.packageJson,
            name: "old",
            author: "old",
            description: "old",
            type: "commonjs",
          }),
        ],
        ...project.files,
        ...(kind === "forge-app"
          ? [
              [
                "manifest.yml",
                "app:\n  id: example\n  runtime:\n    name: nodejs20.x\n",
              ] as [string, string],
            ]
          : []),
      ]),
    ),
  );
  for (const capability of capabilities) {
    owner = capability.name;
    const contribution = createBlueprint(
      "sample",
      "A sample project",
      "tester",
    );
    if (typeof capability.init === "function") capability.init(contribution);
    directory = await seedTemplates(
      directory,
      dag.currentModule().source(),
      contribution.templates,
    );
  }
  const stale = JSON.parse(await directory.file("package.json").contents());
  for (const section of ["scripts", "dependencies", "devDependencies"])
    for (const key of Object.keys(stale[section] ?? {}))
      stale[section][key] = "owner";
  stale.private = false;
  stale.license = "owner";
  stale.engines = { node: "owner" };
  // Each updater sees the same stale input so a previous updater cannot hide
  // a second owner by already setting an identical value.
  const input = mockDirectory(
    new Map((directory as ReturnType<typeof mockDirectory>).files),
  ).withNewFile("package.json", JSON.stringify(stale));
  for (const capability of capabilities) {
    owner = capability.name;
    if (typeof capability.update === "function")
      await capability.update(trackDirectory(input));
  }
  return { owners, directory };
}

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
          "",
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
    init(project) {
      project.files.set("duplicate.txt", "same");
      project.packageJson.scripts.duplicate = "same";
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
