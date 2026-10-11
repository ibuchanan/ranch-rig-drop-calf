import { describe, expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import {
  applyForgeRuntime,
  ConflictError,
  NODE_FORGE_RUNTIME,
  NPMRC,
  nodeContainer,
  reconcileForgeRuntime,
} from "../src/node.ts";
import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";

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
      expect(pkg.engines).toEqual({ node: "24.x" });
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
    expect(reconcileForgeRuntime(contents, true)).toBe(contents);
  });

  test("a different runtime names the conflict and how to fix it", () => {
    const contents = "app:\n  runtime:\n    name: nodejs22.x\n";
    expect(() => reconcileForgeRuntime(contents)).toThrow(ConflictError);
    expect(() => reconcileForgeRuntime(contents)).toThrow(
      `Change app.runtime.name to ${NODE_FORGE_RUNTIME}`,
    );
    expect(reconcileForgeRuntime(contents, true)).toBe(
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
    expect(reconcileForgeRuntime(contents, true)).toBe(
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
      expect(() => reconcileForgeRuntime(contents, true)).toThrow(ParseError);
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

  test("strict reconciliation rejects drift before writing", async () => {
    const directory = {
      exists: async () => true,
      file: () => ({
        contents: async () => "app:\n  runtime:\n    name: nodejs22.x\n",
      }),
    } as never;
    await expect(applyForgeRuntime(directory, "forge-app")).rejects.toThrow(
      ConflictError,
    );
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
