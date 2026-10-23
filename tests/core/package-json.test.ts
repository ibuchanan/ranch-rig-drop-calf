import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import fc from "fast-check";
import { ParseError } from "../../src/core/errors.ts";
import {
  assemblePackage,
  editPackageJson,
  type PackageContribution,
  seedPackage,
  updatePackage,
} from "../../src/core/package-json.ts";
import { mockDirectory } from "../support/module-source.ts";

const contributor = (name: string, packageJson: PackageContribution) => ({
  name,
  packageJson,
});

const read = async (directory: Directory) =>
  JSON.parse(await directory.file("package.json").contents());

test("init applies every seed, then every policy, merging sections per entry", () => {
  const pkg: Record<string, unknown> = {
    name: "sample",
    scripts: { owner: "kept" },
    engines: { node: "24" },
    files: ["old"],
  };
  seedPackage(pkg, [
    contributor("build", {
      seed: { files: ["dist"], devDependencies: { tool: "^1" } },
      policy: { scripts: { build: "tsc" } },
    }),
    contributor("node", { remove: ["engines"] }),
    contributor("lint", { policy: { scripts: { lint: "biome lint" } } }),
  ]);
  expect(pkg).toEqual({
    name: "sample",
    scripts: { owner: "kept", build: "tsc", lint: "biome lint" },
    devDependencies: { tool: "^1" },
    files: ["dist"],
  });
});

test("update enforces policy and removals, leaving seeds and owner entries alone", async () => {
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          files: ["owner"],
          scripts: { build: "stale", owner: "kept" },
          devDependencies: { tool: "owner" },
          engines: { node: "owner" },
        }),
      ],
    ]),
  );
  const contributors = [
    contributor("build", {
      seed: { files: ["dist"], devDependencies: { tool: "^1" } },
      policy: { scripts: { build: "tsc" } },
    }),
    contributor("node", { remove: ["engines"] }),
  ];
  const output = await updatePackage(input, contributors);
  expect(await read(output)).toEqual({
    files: ["owner"],
    scripts: { build: "tsc", owner: "kept" },
    devDependencies: { tool: "owner" },
  });
  expect(await updatePackage(output, contributors)).toBe(output);
});

const freshness = [
  contributor("tools", {
    seed: {
      dependencies: { runtime: "2.0.0" },
      devDependencies: {
        behind: "2.0.0",
        caret: "2.0.0",
        ahead: "2.0.0",
        floor: "2.0.0",
        git: "github:owner/git",
        tag: "2.0.0",
        any: "2.0.0",
        removed: "2.0.0",
      },
    },
  }),
];

test("update raises seeded dependencies behind their pin and leaves the rest", async () => {
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          dependencies: { runtime: "^1.9.0" },
          devDependencies: {
            behind: "1",
            caret: "~1.5.0",
            ahead: "^3",
            floor: "^2.0.0",
            git: "0.0.1",
            tag: "latest",
            any: "*",
            unseeded: "0.0.1",
          },
        }),
      ],
    ]),
  );
  const output = await updatePackage(input, freshness);
  expect(await read(output)).toEqual({
    dependencies: { runtime: "2.0.0" },
    devDependencies: {
      behind: "2.0.0",
      caret: "2.0.0",
      ahead: "^3",
      floor: "^2.0.0",
      git: "0.0.1",
      tag: "latest",
      any: "*",
      unseeded: "0.0.1",
    },
  });
  expect(await updatePackage(output, freshness)).toBe(output);
});

test("update never re-adds a removed dependency or creates its section", async () => {
  const input = mockDirectory(
    new Map([["package.json", JSON.stringify({ name: "x" })]]),
  );
  expect(await updatePackage(input, freshness)).toBe(input);
});

test("init writes every seeded dependency at its pin", () => {
  const pkg: Record<string, unknown> = {
    devDependencies: { behind: "1" },
  };
  seedPackage(pkg, freshness);
  expect(pkg.dependencies).toEqual({ runtime: "2.0.0" });
  expect(pkg.devDependencies).toMatchObject({
    behind: "2.0.0",
    git: "github:owner/git",
  });
});

test("update leaves a missing package.json missing", async () => {
  const empty = mockDirectory();
  const output = await updatePackage(empty, [
    contributor("lint", { policy: { scripts: { lint: "biome lint" } } }),
  ]);
  expect(output).toBe(empty);
  expect(await output.exists("package.json")).toBe(false);
});

test("an unchanged package keeps its bytes, and a changed one is rendered canonically", async () => {
  const text = '{\n    "scripts": {"lint": "biome lint"},\n    "name": "x"\n}';
  const matching = mockDirectory(new Map([["package.json", text]]));
  const contributors = [
    contributor("lint", { policy: { scripts: { lint: "biome lint" } } }),
  ];
  expect(await updatePackage(matching, contributors)).toBe(matching);
  const changed = await editPackageJson(matching, (pkg) => {
    pkg.version = "1.0.0";
  });
  expect(await changed.file("package.json").contents()).toBe(
    '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": {\n    "lint": "biome lint"\n  }\n}\n',
  );
});

test.each([
  [
    "two capabilities",
    [
      contributor("a", { policy: { scripts: { lint: "a" } } }),
      contributor("b", { seed: { scripts: { lint: "b" } } }),
    ],
    "scripts.lint is contributed by both a and b",
  ],
  [
    "one capability's seed and policy",
    [contributor("a", { seed: { files: ["x"] }, policy: { files: ["y"] } })],
    "files is contributed by both a and a",
  ],
  [
    "a removal and a value",
    [
      contributor("a", { policy: { engines: { node: "24" } } }),
      contributor("b", { remove: ["engines"] }),
    ],
    "engines is contributed by both a and b",
  ],
])("assembly rejects a key claimed by %s", (_case, contributors, message) => {
  expect(() => assemblePackage(contributors)).toThrow(message);
});

test("distinct section entries assemble independently of contributor order", () => {
  fc.assert(
    fc.property(
      fc.constantFrom("scripts", "dependencies", "devDependencies"),
      fc.constantFrom("seed", "policy"),
      fc.dictionary(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), fc.string(), {
        minKeys: 2,
        maxKeys: 12,
      }),
      (section, lifecycle, entries) => {
        const contributors = Object.entries(entries).map(([key, value]) =>
          contributor(key, { [lifecycle]: { [section]: { [key]: value } } }),
        );
        const assembled = assemblePackage(contributors);
        expect(assembled[lifecycle]).toEqual(
          contributors.length ? { [section]: entries } : {},
        );
        expect(assemblePackage([...contributors].reverse())).toEqual(assembled);
      },
    ),
  );
});

test.each([
  "{",
  "null",
  "[]",
  '"bad"',
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"scripts":"bad"}',
])("update rejects unsafe package input before writing: %s", async (text) => {
  const input = mockDirectory(new Map([["package.json", text]]));
  const before = [...input.files];
  await expect(
    updatePackage(input, [
      contributor("lint", { policy: { scripts: { lint: "biome lint" } } }),
    ]),
  ).rejects.toBeInstanceOf(ParseError);
  expect([...input.files]).toEqual(before);
});
