import { expect, spyOn, test } from "bun:test";
import { dag, type Secret } from "@dagger.io/dagger";
import { parseDocument } from "yaml";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import {
  forgeManifest,
  forgeRuntimeFromNvmrc,
  reconcileForgeRuntime,
  updateForgeManifest,
  validateForgeManifest,
} from "../src/forge-manifest.ts";
import { DropCalf } from "../src/index.ts";
import { nodeBaseline } from "../src/node.ts";
import { ParseError } from "../src/preclean.ts";
import { resolveProfile } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory } from "./module-source.ts";

const runtime = "nodejs22.x";
test.each([
  ["22\n", "nodejs22.x"],
  ["v24.1.2\r\n", "nodejs24.x"],
  [" 20.19 \n", "nodejs20.x"],
  ["999999", "nodejs999999.x"],
])(
  "numeric .nvmrc %j selects %s without consulting the baseline",
  (pin, wanted) => {
    expect(forgeRuntimeFromNvmrc(pin)).toBe(wanted);
  },
);
test.each([
  "",
  "node",
  "lts/*",
  "lts/jod",
  ">=22",
  "22.x",
  "22\n24",
  "0",
  "022",
  "22.1.2.3",
  "22 # comment",
])("ambiguous .nvmrc %j fails actionably", (pin) => {
  expect(() => forgeRuntimeFromNvmrc(pin)).toThrow(ParseError);
  expect(() => forgeRuntimeFromNvmrc(pin)).toThrow("numeric Node version");
});

test("Forge manifest is selected only for Forge, immediately after Node, with explicit no-op init", () => {
  const capability = forgeManifest();
  expect(noOpReasons([capability])).toEqual([
    {
      capability: "forge-manifest",
      verb: "init",
      reason: expect.stringContaining("does not seed"),
    },
  ]);
  expect(capability.update).toBe(updateForgeManifest);
  expect(typeof capability.validate).toBe("function");
  const names = resolveProfile("forge-app").map((item) => item.name);
  expect(names[names.indexOf("node") + 1]).toBe("forge-manifest");
  for (const kind of ["library", "tool", "agent-skill"])
    expect(
      resolveProfile(kind).some((item) => item.name === "forge-manifest"),
    ).toBe(false);
});

test.each([
  "modules: {}\n",
  "app:\n  id: example\n",
  "app: # not configured yet\n",
  "app:\n  runtime: # not configured yet\n",
  "app:\n  runtime:\n    name: null\n",
  "app:\n  runtime:\n    memoryMB: 512\n",
  "app:\n  runtime:\n    name: # not selected yet\n",
])("fills missing runtime in %j and converges byte-for-byte", (contents) => {
  const result = reconcileForgeRuntime(contents, runtime);
  expect(parseDocument(result).getIn(["app", "runtime", "name"])).toBe(runtime);
  expect(reconcileForgeRuntime(result, runtime)).toBe(result);
});
test("matching runtime preserves unusual formatting byte-for-byte", () => {
  const contents = `# keep this\r\napp: {runtime: {name: '${runtime}', memoryMB: 512}, id: "example"}`;
  expect(reconcileForgeRuntime(contents, runtime)).toBe(contents);
});
test("replacing runtime preserves quotes and inline comments", () => {
  const contents =
    "app:\n  runtime:\n    name: 'nodejs24.x' # pin\n  id: example\n";
  expect(reconcileForgeRuntime(contents, runtime)).toBe(
    contents.replace("nodejs24.x", runtime),
  );
});
test("adding runtime preserves comments, key order, indentation and sibling settings", () => {
  const contents = `# App settings
app:
    id: 'example' # registration
    runtime: # deployment
        memoryMB: 512 # memory
        architecture: "arm64"
modules: {} # wiring
`;
  expect(reconcileForgeRuntime(contents, runtime)).toBe(
    contents.replace(
      '        architecture: "arm64"\n',
      `        architecture: "arm64"\n        name: ${runtime}\n`,
    ),
  );
});
test("preserves CRLF and absence of final newline", () => {
  const contents = "app:\r\n  runtime:\r\n    memoryMB: 512";
  expect(reconcileForgeRuntime(contents, runtime)).toBe(
    `${contents}\r\n    name: ${runtime}`,
  );
});
test.each([
  "app: [broken\n",
  "app: {}\napp: {}\n",
  "app: {}\n---\napp: {}\n",
  "- app\n",
  "app: invalid\n",
  "app:\n  runtime: invalid\n",
])("rejects malformed YAML and non-map parents: %j", (contents) => {
  expect(() => reconcileForgeRuntime(contents, runtime)).toThrow(ParseError);
});

test.each([
  new Map<string, string>(),
  new Map([[".nvmrc", "lts/*"]]),
  new Map([["manifest.yml", "app: [broken\n"]]),
])(
  "missing manifest or pin is a no-op without parsing or creating files",
  async (files) => {
    const input = mockDirectory(files);
    expect(await updateForgeManifest(input)).toBe(input);
  },
);
test("update derives the runtime from .nvmrc, preserves other files and is idempotent", async () => {
  const contents =
    "app:\n  id: example\n  runtime:\n    name: 'nodejs24.x' # runtime\n    memoryMB: 512\n";
  const input = mockDirectory(
    new Map([
      [".nvmrc", "v22.12.0\n"],
      ["manifest.yml", contents],
      ["owner.txt", "kept"],
    ]),
  );
  const before = [...input.files];
  const output = await updateForgeManifest(input);
  expect(await output.file("manifest.yml").contents()).toBe(
    contents.replace("nodejs24.x", runtime),
  );
  expect(await output.file(".nvmrc").contents()).toBe("v22.12.0\n");
  expect(await output.file("owner.txt").contents()).toBe("kept");
  expect(await updateForgeManifest(output)).toBe(output);
  expect([...input.files]).toEqual(before);
});
test("Node first establishes its policy; manifest then reads the resulting .nvmrc", async () => {
  const input = mockDirectory(
    new Map([
      [".nvmrc", "22\n"],
      ["manifest.yml", "app:\n  runtime:\n    name: nodejs22.x\n"],
    ]),
  );
  const output = await updateCapabilities(input, [
    nodeBaseline("forge-app"),
    forgeManifest(),
  ]);
  expect(await output.file(".nvmrc").contents()).toBe("24\n");
  expect(await output.file("manifest.yml").contents()).toContain("nodejs24.x");
  expect(
    await updateCapabilities(output, [
      nodeBaseline("forge-app"),
      forgeManifest(),
    ]),
  ).toBe(output);
});
test("standalone update rejects an ambiguous pin without changing the input", async () => {
  const input = mockDirectory(
    new Map([
      [".nvmrc", "lts/*"],
      ["manifest.yml", "app: {}\n"],
    ]),
  );
  await expect(updateForgeManifest(input)).rejects.toThrow(
    "numeric Node version",
  );
  expect(await input.file("manifest.yml").contents()).toBe("app: {}\n");
});

test("validation skips a missing manifest without allocating tools", async () => {
  const spy = spyOn(dag, "container");
  try {
    expect(await validateForgeManifest(mockDirectory())).toEqual({
      status: "skipped",
      reason: "manifest.yml is missing",
    });
    expect(spy).not.toHaveBeenCalled();
    expect(
      JSON.parse(await new DropCalf().validateForgeManifest(mockDirectory())),
    ).toEqual({ status: "skipped", reason: "manifest.yml is missing" });
  } finally {
    spy.mockRestore();
  }
});
test.each([
  { email: undefined, token: undefined },
  { email: {} as Secret, token: undefined },
  { email: undefined, token: {} as Secret },
])(
  "missing or partial credentials fail before allocating tools: %j",
  async (credentials) => {
    const input = mockDirectory(new Map([["manifest.yml", "app: {}\n"]]));
    const spy = spyOn(dag, "container");
    try {
      const result = await validateForgeManifest(
        input,
        credentials.email,
        credentials.token,
      );
      expect(result).toEqual({
        status: "failed",
        reason: expect.stringContaining(
          "supply both --forge-email and --forge-api-token",
        ),
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  },
);

test("validation runs pinned Forge lint on a read-only repo and keeps all diagnostics", async () => {
  const commands: string[][] = [];
  const mounts: unknown[] = [];
  const secrets: unknown[] = [];
  const email = {} as Secret;
  const token = {} as Secret;
  const input = mockDirectory(
    new Map([
      ["manifest.yml", "app: {}\n"],
      [".nvmrc", "lts/*"],
    ]),
  );
  const before = [...input.files];
  const container = {
    from: () => container,
    file: () => ({}),
    withFile: () => container,
    withEnvVariable: () => container,
    withSecretVariable: (...args: unknown[]) => {
      secrets.push(args);
      return container;
    },
    withWorkdir: () => container,
    withExec: (command: string[]) => {
      commands.push(command);
      return container;
    },
    withMountedDirectory: (...args: unknown[]) => {
      mounts.push(args);
      return container;
    },
    stdout: async () => "No issues found.",
  };
  const spy = spyOn(dag, "container").mockReturnValue(container as never);
  try {
    expect(
      JSON.parse(
        await new DropCalf().validateForgeManifest(input, email, token),
      ),
    ).toEqual({ status: "validated" });
    expect(secrets).toEqual([
      ["FORGE_EMAIL", email],
      ["FORGE_API_TOKEN", token],
    ]);
    expect(commands).toContainEqual([
      "bun",
      "add",
      "--ignore-scripts",
      `@forge/cli@${TOOL_VERSIONS.forgeCli}`,
    ]);
    expect(commands.at(-1)).toEqual([
      "bun",
      "run",
      "/tools/node_modules/@forge/cli/out/bin/cli.js",
      "lint",
      "--environment",
      "development",
    ]);
    expect(mounts).toEqual([["/repo", input, { readOnly: true }]]);
    expect([...input.files]).toEqual(before);
    const minimal = mockDirectory(new Map([["manifest.yml", "app: {}\n"]]));
    const profile = JSON.parse(
      await new DropCalf().validate(
        minimal,
        "forge-app",
        [],
        [],
        undefined,
        email,
        token,
      ),
    );
    expect(
      profile.find(
        (item: { capability: string }) => item.capability === "forge-manifest",
      ),
    ).toEqual({ capability: "forge-manifest", status: "validated" });
    const failure = spyOn(container, "stdout").mockRejectedValue(
      Object.assign(new Error("exec failed"), {
        stdout: "manifest rejected",
        stderr: "invalid runtime",
      }),
    );
    try {
      const report = await validateCapabilities(input, [
        forgeManifest(email, token),
      ]);
      expect(report).toEqual([
        {
          capability: "forge-manifest",
          status: "failed",
          reason: expect.stringContaining("manifest rejected\ninvalid runtime"),
        },
      ]);
      expect([...input.files]).toEqual(before);
    } finally {
      failure.mockRestore();
    }
  } finally {
    spy.mockRestore();
  }
});
