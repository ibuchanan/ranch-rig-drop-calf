import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  forgeRuntimeFromNvmrc,
  reconcileForgeRuntime,
} from "../src/forge-manifest.ts";
import { DropCalf } from "../src/index.ts";
import { mergeScaffoldPackage, scaffoldName } from "../src/init.ts";
import { NODE_NVMRC } from "../src/node.ts";

const NODE_FORGE_RUNTIME = forgeRuntimeFromNvmrc(NODE_NVMRC);

import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

/** The shape `forge create` leaves behind once `remove-scaffold` has run. */
const precleaned = JSON.stringify({
  main: "index.js",
  private: true,
  scripts: {},
  devDependencies: {},
  dependencies: { "@forge/api": "^7.0.0", "@forge/resolver": "^1.0.0" },
});

const generated = (kind = "forge-app") =>
  `${JSON.stringify(buildProject(kind, "sample", "tester").packageJson, null, 2)}\n`;

test("the scaffold's runtime dependencies survive alongside generated ones", () => {
  const merged = JSON.parse(mergeScaffoldPackage(precleaned, generated()));
  expect(merged.dependencies["@forge/api"]).toBe("^7.0.0");
  expect(merged.dependencies["@forge/resolver"]).toBe("^1.0.0");
  const owned = buildProject("forge-app", "sample", "tester").packageJson;
  for (const [name, version] of Object.entries(owned.dependencies ?? {}))
    expect(merged.dependencies[name]).toBe(version);
  expect(merged.scripts).toEqual(owned.scripts);
  expect(merged.private).toBe(true);
});

test("generated keys win over the scaffold's", () => {
  const owned = buildProject("forge-app", "sample", "tester").packageJson;
  const pinned = Object.keys(owned.dependencies ?? {})[0] as string;
  const stale = JSON.stringify({
    main: "index.js",
    dependencies: { [pinned]: "0.0.1" },
  });
  const forgeApp = JSON.parse(mergeScaffoldPackage(stale, generated()));
  expect(forgeApp.dependencies[pinned]).toBe(owned.dependencies?.[pinned]);
  const library = JSON.parse(mergeScaffoldPackage(stale, generated("library")));
  expect(library.main).toBe("dist/index.mjs");
});

test("with no scaffold package.json the generated one is used as is", () => {
  expect(mergeScaffoldPackage(undefined, generated())).toBe(generated());
});

test("an unparseable scaffold package.json is reported, not overwritten", () => {
  expect(() => mergeScaffoldPackage("{nope", generated())).toThrow(ParseError);
});

test("scaffoldName reads the scaffold's own package name", () => {
  expect(scaffoldName('{"name":"my-forge-app"}')).toBe("my-forge-app");
  expect(scaffoldName('{"name":"  "}')).toBeUndefined();
  expect(scaffoldName(undefined)).toBeUndefined();
});

test("the public module uses init instead of exposing files", () => {
  expect("files" in new DropCalf()).toBe(false);
});

test.each([
  {
    label: "explicit name wins over scaffold and workspace",
    packageName: "explicit-name",
    scaffold: '{"name":"scaffold-name"}',
    expected: "explicit-name",
  },
  {
    label: "explicit name works without a scaffold",
    packageName: "explicit-name",
    scaffold: undefined,
    expected: "explicit-name",
  },
  {
    label: "scaffold name wins over workspace",
    packageName: undefined,
    scaffold: '{"name":"scaffold-name"}',
    expected: "scaffold-name",
  },
  {
    label: "empty directory uses the workspace basename",
    packageName: undefined,
    scaffold: undefined,
    expected: "workspace name",
  },
  {
    label: "blank scaffold name uses the workspace basename",
    packageName: undefined,
    scaffold: '{"name":"  "}',
    expected: "workspace name",
  },
  {
    label: "missing scaffold name uses the workspace basename",
    packageName: undefined,
    scaffold: "{}",
    expected: "workspace name",
  },
])("init naming: $label", async ({ packageName, scaffold, expected }) => {
  const input = mockDirectory(
    new Map(scaffold === undefined ? [] : [["package.json", scaffold]]),
  );
  const source = mockModuleSource();
  const directory = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  const workspace = spyOn(dag, "currentWorkspace").mockReturnValue({
    address: async () => "file:///projects/workspace%20name/",
  } as ReturnType<typeof dag.currentWorkspace>);
  try {
    const result = await new DropCalf().init(
      input,
      "tool",
      "tester",
      packageName,
    );
    expect(JSON.parse(await result.file("package.json").contents()).name).toBe(
      expected,
    );
    expect(workspace).toHaveBeenCalledTimes(
      packageName === undefined && expected === "workspace name" ? 1 : 0,
    );
  } finally {
    workspace.mockRestore();
    directory.mockRestore();
    source.mockRestore();
  }
});

type Fake = ReturnType<typeof mockDirectory>;
const fake = mockDirectory;

test.each([
  "modules: {}\n",
  "app:\n  id: example\n  runtime:\n    name: nodejs22.x # scaffold\n    memoryMB: 512\n    architecture: arm64\nmodules: {}\n",
  `app:\n  runtime:\n    name: ${NODE_FORGE_RUNTIME}\n`,
  undefined,
])(
  "init keeps app files and dependencies and normalizes only a present manifest: %j",
  async (manifest) => {
    const scaffold = fake(
      new Map([
        [
          "package.json",
          JSON.stringify({
            name: "forge-blank",
            version: "1.0.0",
            main: "index.js",
            scripts: { lint: "eslint ." },
            dependencies: { "@forge/api": "^7.0.0" },
          }),
        ],
        ...(manifest === undefined
          ? []
          : [["manifest.yml", manifest] as [string, string]]),
        ["src/index.js", "export {};\n"],
        ["README.md", "# scaffold\n"],
        [".eslintrc", "{}\n"],
      ]),
    );
    const source = mockModuleSource();
    const spy = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const result = (await new DropCalf().init(
        scaffold as never,
        "forge-app",
        "tester",
      )) as unknown as Fake;
      expect(result.files.has(".eslintrc")).toBe(false);
      expect(result.files.get("README.md")).not.toBe("# scaffold\n");
      expect(result.files.has("LICENSE")).toBe(true);
      expect(result.files.get("manifest.yml")).toBe(
        manifest === undefined
          ? undefined
          : reconcileForgeRuntime(manifest, NODE_FORGE_RUNTIME),
      );
      expect(result.files.has("src/index.js")).toBe(false);
      expect(result.files.get("src/index.ts")).toBe("export {};\n");
      const pkg = JSON.parse(result.files.get("package.json") ?? "{}");
      expect(pkg.name).toBe("forge-blank");
      expect(pkg.main).toBe("index.js");
      expect(pkg.dependencies["@forge/api"]).toBe("^7.0.0");
      expect(pkg.scripts.lint).not.toBe("eslint .");
    } finally {
      spy.mockRestore();
      source.mockRestore();
    }
  },
);

test.each(["library", "tool", "agent-skill"])(
  "%s init leaves even an unparseable manifest alone",
  async (profile) => {
    const manifest = "app: [unparseable\n";
    const scaffold = fake(new Map([["manifest.yml", manifest]]));
    const source = mockModuleSource();
    const spy = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const result = (await new DropCalf().init(
        scaffold as never,
        profile,
        "tester",
        "sample",
      )) as unknown as Fake;
      expect(result.files.get("manifest.yml")).toBe(manifest);
    } finally {
      spy.mockRestore();
      source.mockRestore();
    }
  },
);

test("init rejects invalid Forge YAML without changing input", async () => {
  const scaffold = fake(new Map([["manifest.yml", "app: [unparseable\n"]]));
  const source = mockModuleSource();
  const spy = spyOn(dag, "directory").mockImplementation(() => mockDirectory());
  try {
    await expect(
      new DropCalf().init(scaffold as never, "forge-app", "tester", "sample"),
    ).rejects.toThrow(ParseError);
    expect([...scaffold.files]).toEqual([
      ["manifest.yml", "app: [unparseable\n"],
    ]);
  } finally {
    spy.mockRestore();
    source.mockRestore();
  }
});

test.each(
  (["init", "initChanges"] as const).flatMap((operation) =>
    ["catalog-info.yaml", ".atlassian/OWNER"].flatMap((marker) =>
      ["", "not valid YAML: [", "kind: Component\n"].map((contents) => ({
        operation,
        marker,
        contents,
      })),
    ),
  ),
)(
  "$operation refuses an existing $marker without touching owner files: %j",
  async ({ operation, marker, contents }) => {
    const input = mockDirectory(
      new Map([
        [marker, contents],
        ["package.json", "not valid JSON"],
        ["README.md", "# Owner-written README\n"],
        ["AGENTS.md", "# Owner-written guidance\n"],
        ["tsconfig.json", "// Owner compiler settings\n{}\n"],
      ]),
    );
    const before = [...input.files];
    await expect(
      new DropCalf()[operation](input, "forge-app", "tester", "sample"),
    ).rejects.toThrow(
      `init is a one-time operation: ${marker} already exists; use update instead.`,
    );
    expect([...input.files]).toEqual(before);
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s init refuses a rerun after owner edits",
  async (profile) => {
    const source = mockModuleSource();
    const directory = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        profile,
        "tester",
        "sample",
      );
      const edited = initialized
        .withNewFile("README.md", "# Owner-written README\n")
        .withNewFile("AGENTS.md", "# Owner-written guidance\n")
        .withNewFile("tsconfig.json", "// Owner compiler settings\n{}\n");
      for (const marker of ["catalog-info.yaml", ".atlassian/OWNER"]) {
        const input = (
          marker === "catalog-info.yaml"
            ? edited
            : edited.withoutFile("catalog-info.yaml")
        ) as ReturnType<typeof mockDirectory>;
        const before = [...input.files];
        await expect(
          module.init(input, profile, "tester", "sample"),
        ).rejects.toThrow(`${marker} already exists; use update instead`);
        expect([...input.files]).toEqual(before);
      }
    } finally {
      directory.mockRestore();
      source.mockRestore();
    }
  },
);

test("Forge init rewrites UI Kit resources and preserves Custom UI source bytes", async () => {
  const manifest =
    "modules:\n  function:\n    - key: resolver\n      handler: index.handler\nresources:\n  - key: main\n    path: src/frontend/index.jsx\n  - key: custom\n    path: static/app/build\n";
  const input = fake(
    new Map([
      ["src/index.js", "export const handler = () => 1;\n"],
      ["src/frontend/index.jsx", "export const App = () => null;\n"],
      ["static/app/src/App.js", "export default () => null;\n"],
      ["manifest.yml", manifest],
    ]),
  );
  const before = [...input.files];
  const source = mockModuleSource();
  const directory = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const output = (await new DropCalf().init(
      input,
      "forge-app",
      "tester",
      "sample",
    )) as Fake;
    expect(output.files.get("src/index.ts")).toBe(
      input.files.get("src/index.js"),
    );
    expect(output.files.get("src/frontend/index.tsx")).toBe(
      input.files.get("src/frontend/index.jsx"),
    );
    expect(output.files.has("src/index.js")).toBe(false);
    expect(output.files.has("src/frontend/index.jsx")).toBe(false);
    expect(output.files.get("static/app/src/App.js")).toBe(
      input.files.get("static/app/src/App.js"),
    );
    expect(output.files.get("manifest.yml")).toContain(
      "path: src/frontend/index.tsx",
    );
    expect(output.files.get("manifest.yml")).toContain(
      "path: static/app/build",
    );
    expect(output.files.get("manifest.yml")).toContain(
      "handler: index.handler",
    );
    expect([...input.files]).toEqual(before);
  } finally {
    directory.mockRestore();
    source.mockRestore();
  }
});

test("Forge update never renames JavaScript source or rewrites its resource paths", async () => {
  const manifest = `app:\n  runtime:\n    name: ${NODE_FORGE_RUNTIME}\nresources:\n  - key: main\n    path: src/frontend/index.jsx\n`;
  const input = fake(
    new Map([
      [
        "catalog-info.yaml",
        "apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: sample\n  title: Sample\n  annotations:\n    forge-ranch/copyright-date: '2026'\n    forge-ranch/license: Apache-2.0\nspec:\n  type: forge-app\n  owner: user:default/tester\n",
      ],
      ["src/index.js", "export const run = () => 1;\n"],
      ["src/frontend/index.jsx", "export const App = () => null;\n"],
      ["manifest.yml", manifest],
    ]),
  );
  const source = mockModuleSource();
  try {
    const output = (await new DropCalf().update(input, "forge-app")) as Fake;
    expect(output.files.get("src/index.js")).toBe(
      input.files.get("src/index.js"),
    );
    expect(output.files.get("src/frontend/index.jsx")).toBe(
      input.files.get("src/frontend/index.jsx"),
    );
    expect(output.files.has("src/index.ts")).toBe(false);
    expect(output.files.has("src/frontend/index.tsx")).toBe(false);
    expect(output.files.get("manifest.yml")).toBe(manifest);
  } finally {
    source.mockRestore();
  }
});

test("init rejects an invalid selection before touching the directory", async () => {
  await expect(
    new DropCalf().init({} as never, "nonsense", "tester"),
  ).rejects.toThrow();
});
