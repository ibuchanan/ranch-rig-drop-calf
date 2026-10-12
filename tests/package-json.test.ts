import { expect, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { ParseError } from "../src/errors.ts";
import {
  assemblePackage,
  editPackageJson,
  enforcePackagePolicy,
  type PackageContribution,
  seedPackage,
} from "../src/package-json.ts";
import { mockDirectory } from "./module-source.ts";

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
  const output = await enforcePackagePolicy(input, contributors);
  expect(await read(output)).toEqual({
    files: ["owner"],
    scripts: { build: "tsc", owner: "kept" },
    devDependencies: { tool: "owner" },
  });
  expect(await enforcePackagePolicy(output, contributors)).toBe(output);
});

test("update leaves a missing package.json missing", async () => {
  const empty = mockDirectory();
  const output = await enforcePackagePolicy(empty, [
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
  expect(await enforcePackagePolicy(matching, contributors)).toBe(matching);
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

test("distinct entries in one section are not a collision", () => {
  expect(
    assemblePackage([
      contributor("a", { policy: { scripts: { lint: "a" } } }),
      contributor("b", { policy: { scripts: { format: "b" } } }),
    ]).policy,
  ).toEqual({ scripts: { lint: "a", format: "b" } });
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
    enforcePackagePolicy(input, [
      contributor("lint", { policy: { scripts: { lint: "biome lint" } } }),
    ]),
  ).rejects.toBeInstanceOf(ParseError);
  expect([...input.files]).toEqual(before);
});
