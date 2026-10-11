import { describe, expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import {
  applyForgeRuntime,
  NODE_FORGE_RUNTIME,
  NPMRC,
  nodeContainer,
  reconcileForgeRuntime,
} from "../src/node.ts";
import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";
import { mockDirectory } from "./module-source.ts";

describe("node baseline", () => {
  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s pins one Node baseline across package.json, .nvmrc and .npmrc",
    (kind) => {
      const { packageJson: pkg, files } = buildProject(
        kind,
        "sample",
        "tester",
      );
      expect(files.get(".nvmrc")).toBe("24\n");
      expect(files.get(".npmrc")).toBe(NPMRC);
      expect(pkg.engines).toBeUndefined();
      expect(pkg.devDependencies["@types/node"]).toBe("24");
    },
  );

  test("never authors a manifest.yml; `forge create` supplies it", () => {
    for (const kind of ["forge-app", "tool", "library", "agent-skill"])
      expect(
        buildProject(kind, "sample", "tester").files.has("manifest.yml"),
      ).toBe(false);
  });
});

describe("Forge runtime reconciliation", () => {
  test.each([
    "modules: {}\n",
    "app:\n  id: example\n",
    "app: # not configured yet\n",
    "app:\n  runtime: # not configured yet\n",
    "app:\n  runtime:\n    name: null\n",
    "app:\n  runtime:\n    memoryMB: 512\n",
    "app:\n  runtime:\n    name: # not selected yet\n",
  ])("fills a missing runtime name in %j", (contents) => {
    const result = reconcileForgeRuntime(contents);
    expect(parseDocument(result).getIn(["app", "runtime", "name"])).toBe(
      NODE_FORGE_RUNTIME,
    );
    expect(reconcileForgeRuntime(result)).toBe(result);
  });

  test("a matching runtime is byte-for-byte unchanged, even with unusual formatting", () => {
    const contents = `# keep this\r\napp: {runtime: {name: '${NODE_FORGE_RUNTIME}', memoryMB: 512}, id: "example"}`;
    expect(reconcileForgeRuntime(contents)).toBe(contents);
  });

  test("a different runtime is replaced by the authoritative baseline", () => {
    const contents = "app:\n  runtime:\n    name: nodejs22.x\n";
    expect(reconcileForgeRuntime(contents)).toBe(
      `app:\n  runtime:\n    name: ${NODE_FORGE_RUNTIME}\n`,
    );
  });

  test("preserves comments, key order, quotes, indentation and sibling settings", () => {
    const contents = `# App settings
app:
    id: 'example' # registration
    runtime: # deployment
        memoryMB: 512 # memory
        architecture: "arm64"
modules: {} # wiring
`;
    const result = reconcileForgeRuntime(contents);
    expect(result).toBe(`# App settings
app:
    id: 'example' # registration
    runtime: # deployment
        memoryMB: 512 # memory
        architecture: "arm64"
        name: ${NODE_FORGE_RUNTIME}
modules: {} # wiring
`);
  });

  test("init replacement preserves the runtime scalar's quotes and inline comment", () => {
    const contents =
      "app:\n  runtime:\n    name: 'nodejs22.x' # runtime\n  id: example\n";
    expect(reconcileForgeRuntime(contents)).toBe(
      `app:\n  runtime:\n    name: '${NODE_FORGE_RUNTIME}' # runtime\n  id: example\n`,
    );
  });

  test("preserves CRLF and absence of a final newline when adding a name", () => {
    const contents = "app:\r\n  runtime:\r\n    memoryMB: 512";
    expect(reconcileForgeRuntime(contents)).toBe(
      `app:\r\n  runtime:\r\n    memoryMB: 512\r\n    name: ${NODE_FORGE_RUNTIME}`,
    );
  });

  test.each([
    "app: [broken\n",
    "app: {}\napp: {}\n",
    "app: {}\n---\napp: {}\n",
    "- app\n",
    "app: invalid\n",
    "app:\n  runtime: invalid\n",
  ])(
    "reports invalid YAML or non-map parents as ParseError: %j",
    (contents) => {
      expect(() => reconcileForgeRuntime(contents)).toThrow(ParseError);
    },
  );
});

describe("Forge runtime Dagger boundary", () => {
  test.each(["library", "tool", "agent-skill"])(
    "%s never even reads a manifest",
    async (kind) => {
      const directory = {} as never;
      expect(await applyForgeRuntime(directory, kind)).toBe(directory);
    },
  );

  test("a missing manifest is not created", async () => {
    const directory = { exists: async () => false } as never;
    expect(await applyForgeRuntime(directory, "forge-app")).toBe(directory);
  });

  test("a matching manifest returns the original directory without a write", async () => {
    const directory = {
      exists: async () => true,
      file: () => ({
        contents: async () =>
          `app:\n  runtime:\n    name: ${NODE_FORGE_RUNTIME}\n`,
      }),
    } as never;
    expect(await applyForgeRuntime(directory, "forge-app")).toBe(directory);
  });

  test("runtime drift is replaced while the input stays unchanged", async () => {
    const contents = "app:\n  runtime:\n    name: nodejs22.x\n";
    const directory = mockDirectory(new Map([["manifest.yml", contents]]));
    const result = await applyForgeRuntime(directory, "forge-app");
    expect(await result.file("manifest.yml").contents()).toBe(
      `app:\n  runtime:\n    name: ${NODE_FORGE_RUNTIME}\n`,
    );
    expect(directory.files.get("manifest.yml")).toBe(contents);
  });
});

test("nodeContainer builds the baseline image through native Dagger", () => {
  const images: string[] = [];
  const container = {
    from: (image: string) => {
      images.push(image);
      return container;
    },
  };
  const spy = spyOn(dag, "container").mockReturnValue(container as never);
  try {
    expect(nodeContainer()).toBe(container as never);
    expect(images).toEqual(["node:24"]);
  } finally {
    spy.mockRestore();
  }
});
