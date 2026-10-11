import { expect, spyOn, test } from "bun:test";
import { DropCalf } from "../src/index.ts";
import { mergeScaffoldPackage, scaffoldName } from "../src/init.ts";
import { NODE_FORGE_RUNTIME, reconcileForgeRuntime } from "../src/node.ts";
import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";

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
  expect(library.main).toBe("./dist/index.js");
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

type Fake = {
  files: Map<string, string>;
  exists(path: string): Promise<boolean>;
  file(path: string): { contents(): Promise<string> };
  withoutFile(path: string): Fake;
  withNewFile(path: string, contents: string): Fake;
  withDirectory(path: string, source: Fake): Fake;
};
const fake = (files: Map<string, string>): Fake => ({
  files,
  exists: async (path) => files.has(path),
  file: (path) => ({ contents: async () => files.get(path) as string }),
  withoutFile: (path) => {
    const next = new Map(files);
    next.delete(path);
    return fake(next);
  },
  withNewFile: (path, contents) => fake(new Map(files).set(path, contents)),
  withDirectory: (_path, source) => fake(new Map([...files, ...source.files])),
});

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
    const names: (string | undefined)[] = [];
    const spy = spyOn(DropCalf.prototype, "files").mockImplementation(
      async (profile, owner, packageName) => {
        names.push(packageName);
        const project = buildProject(profile, packageName ?? "x", owner);
        return fake(
          new Map([
            ["package.json", `${JSON.stringify(project.packageJson)}\n`],
            ["README.md", "# generated\n"],
            ["tsconfig.json", "{}\n"],
          ]),
        ) as never;
      },
    );
    try {
      const result = (await new DropCalf().init(
        scaffold as never,
        "forge-app",
        "tester",
      )) as unknown as Fake;
      expect(names).toEqual(["forge-blank"]);
      expect(result.files.has(".eslintrc")).toBe(false);
      expect(result.files.get("README.md")).toBe("# generated\n");
      expect(result.files.get("manifest.yml")).toBe(
        manifest === undefined
          ? undefined
          : reconcileForgeRuntime(manifest, true),
      );
      expect(result.files.get("src/index.js")).toBe("export {};\n");
      const pkg = JSON.parse(result.files.get("package.json") ?? "{}");
      expect(pkg.name).toBe("forge-blank");
      expect(pkg.main).toBe("index.js");
      expect(pkg.dependencies["@forge/api"]).toBe("^7.0.0");
      expect(pkg.scripts.lint).not.toBe("eslint .");
    } finally {
      spy.mockRestore();
    }
  },
);

test.each(["library", "tool", "agent-skill"])(
  "%s init leaves even an unparseable manifest alone",
  async (profile) => {
    const manifest = "app: [unparseable\n";
    const scaffold = fake(new Map([["manifest.yml", manifest]]));
    const spy = spyOn(DropCalf.prototype, "files").mockResolvedValue(
      fake(new Map([["package.json", generated(profile)]])) as never,
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
    }
  },
);

test("init rejects invalid Forge YAML before generating output", async () => {
  const scaffold = fake(new Map([["manifest.yml", "app: [unparseable\n"]]));
  const spy = spyOn(DropCalf.prototype, "files");
  try {
    await expect(
      new DropCalf().init(scaffold as never, "forge-app", "tester"),
    ).rejects.toThrow(ParseError);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("init rejects an invalid selection before touching the directory", async () => {
  await expect(
    new DropCalf().init({} as never, "nonsense", "tester"),
  ).rejects.toThrow();
});
