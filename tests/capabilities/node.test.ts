import { describe, expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { NPMRC, nodeBaseline } from "../../src/capabilities/node.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { ParseError } from "../../src/core/errors.ts";
import { mergeScaffoldPackage } from "../../src/core/package-json.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import {
  capabilityOf,
  runUpdate,
  verb,
} from "../support/capability-fixtures.ts";
import { mockContainer } from "../support/container-source.ts";
import { mockDirectory } from "../support/module-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];
const licenseCatalog =
  "metadata:\n  annotations:\n    forge-ranch/license: Apache-2.0\n";

describe("node baseline", () => {
  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s pins one Node baseline across package.json, .nvmrc and .npmrc",
    (kind) => {
      const { packageJson: pkg, files } = buildProject(
        kind,
        "sample",
        "tester",
      );
      expect(files.get(".nvmrc")).toBe(kind === "library" ? "22\n" : "24\n");
      expect(files.get(".npmrc")).toBe(NPMRC);
      expect(pkg.engines).toBeUndefined();
      expect(pkg.devDependencies["@types/node"]).toBe(
        kind === "library" ? "22" : "24",
      );
    },
  );

  test.each(["", "0", "-22", "22.x", "22\n", "node22", "22.0"])(
    "rejects invalid explicit Node major %j",
    (major) =>
      expect(() => nodeBaseline({ major })).toThrow("positive numeric major"),
  );

  test("never authors a manifest.yml; forge create supplies it", () => {
    for (const kind of ["forge-app", "tool", "library", "agent-skill"])
      expect(
        buildProject(kind, "sample", "tester").files.has("manifest.yml"),
      ).toBe(false);
  });
});

test.each(kinds)(
  "%s Node verbs are active and initialized pins need no update",
  async (kind) => {
    const capability = capabilityOf(kind, "node");
    expect(typeof capability.init).toBe("function");
    expect(typeof capability.update).toBe("function");
    expect(typeof capability.validate).toBe("function");
    const project = buildProject(kind, "sample", "tester");
    const input = mockDirectory(
      new Map([
        ...project.files,
        ["catalog-info.yaml", licenseCatalog],
        [
          "package.json",
          JSON.stringify({ ...project.packageJson, license: "Apache-2.0" }),
        ],
      ]),
    );
    expect(await runUpdate(capabilityOf(kind, "node"), input)).toBe(input);
  },
);

test.each(kinds)(
  "%s update owns file pins, preserves types, and applies kind-specific engines policy",
  async (kind) => {
    const pkg = {
      name: "sample",
      license: "Apache-2.0",
      engines: { node: ">=20", npm: ">=10" },
      devDependencies: { "@types/node": "20", unrelated: "1" },
      dependencies: { kept: "2" },
      scripts: { custom: "echo kept" },
    };
    const manifest =
      "app:\n  id: 'example'\n  runtime:\n    name: 'nodejs22.x' # pin\n    memoryMB: 512\n";
    const input = mockDirectory(
      new Map([
        ["catalog-info.yaml", licenseCatalog],
        ["package.json", JSON.stringify(pkg)],
        ["manifest.yml", manifest],
        [".nvmrc", "22\n"],
        [
          ".npmrc",
          "registry=https://example.invalid/\n@acme:registry=https://example.invalid/\n//example.invalid/:_authToken=fixture\n",
        ],
        ["README.md", "owner text"],
      ]),
    );
    const before = [...input.files];
    const output = await runUpdate(capabilityOf(kind, "node"), input);
    const result = JSON.parse(await output.file("package.json").contents());
    const expectedPkg = {
      ...pkg,
      devDependencies: {
        "@types/node": kind === "library" ? "22" : "24",
        unrelated: "1",
      },
    };
    const { engines: _engines, ...withoutEngines } = expectedPkg;
    expect(result).toEqual(kind === "forge-app" ? withoutEngines : expectedPkg);
    expect(await output.file(".nvmrc").contents()).toBe(
      kind === "library" ? "22\n" : "24\n",
    );
    expect(await output.file(".npmrc").contents()).toBe(NPMRC);
    expect(await output.file("README.md").contents()).toBe("owner text");
    expect(await output.file("manifest.yml").contents()).toBe(manifest);
    expect(await runUpdate(capabilityOf(kind, "node"), output)).toBe(output);
    expect([...input.files]).toEqual(before);
  },
);

test.each(kinds)(
  "%s update creates file pins but no package or manifest",
  async (kind) => {
    const output = await runUpdate(capabilityOf(kind, "node"), mockDirectory());
    expect(await output.exists(".nvmrc")).toBe(true);
    expect(await output.exists(".npmrc")).toBe(true);
    expect(await output.exists("package.json")).toBe(false);
    expect(await output.exists("manifest.yml")).toBe(false);
    expect(await runUpdate(capabilityOf(kind, "node"), output)).toBe(output);
  },
);

test.each([
  ["^24.0.0", "22"],
  [">=22", "22"],
  ["^20.0.0 || ^22.0.0", "22"],
  ["*", "22"],
  ["^22.10.0", "^22.10.0"],
  ["~22.15.0", "~22.15.0"],
  ["22.12.0", "22.12.0"],
  [">=22 <23", ">=22 <23"],
])(
  "library constrains Node types %s to %s in either dependency section",
  async (reference, expected) => {
    for (const section of ["dependencies", "devDependencies"]) {
      const input = mockDirectory(
        new Map([
          ["catalog-info.yaml", licenseCatalog],
          [".nvmrc", "24\n"],
          [
            "package.json",
            JSON.stringify({
              license: "Apache-2.0",
              engines: { node: ">=22" },
              [section]: { "@types/node": reference, kept: "1" },
            }),
          ],
        ]),
      );
      const capability = capabilityOf("library", "node");
      const output = await runUpdate(capability, input);
      const pkg = JSON.parse(await output.file("package.json").contents());
      expect(pkg[section]).toEqual({ "@types/node": expected, kept: "1" });
      expect(pkg.engines).toEqual({ node: ">=22" });
      expect(await output.file(".nvmrc").contents()).toBe("22\n");
      expect(await runUpdate(capability, output)).toBe(output);
    }
  },
);

test("default Node policy still preserves newer owner type ranges", async () => {
  const input = mockDirectory(
    new Map([
      ["catalog-info.yaml", licenseCatalog],
      [
        "package.json",
        JSON.stringify({ devDependencies: { "@types/node": "^26.0.0" } }),
      ],
    ]),
  );
  const output = await runUpdate(capabilityOf("tool", "node"), input);
  expect(
    JSON.parse(await output.file("package.json").contents()).devDependencies[
      "@types/node"
    ],
  ).toBe("^26.0.0");
});

test("update never adds a missing types dependency or rewrites an unowned package", async () => {
  const contents =
    '{"license":"Apache-2.0","devDependencies":{},"engines":{"node":">=18"}}';
  const output = await runUpdate(
    capabilityOf("library", "node"),
    mockDirectory(
      new Map([
        ["package.json", contents],
        ["catalog-info.yaml", licenseCatalog],
      ]),
    ),
  );
  expect(await output.file("package.json").contents()).toBe(contents);
  const forge = await runUpdate(
    capabilityOf("forge-app", "node"),
    mockDirectory(
      new Map([
        ["package.json", '{"license":"Apache-2.0"}'],
        ["catalog-info.yaml", licenseCatalog],
      ]),
    ),
  );
  expect(await forge.file("package.json").contents()).toBe(
    '{"license":"Apache-2.0"}',
  );
});

test.each(["{", "[]", "null"])(
  "Forge update rejects malformed package input: %s",
  async (contents) => {
    await expect(
      runUpdate(
        capabilityOf("forge-app", "node"),
        mockDirectory(new Map([["package.json", contents]])),
      ),
    ).rejects.toThrow(ParseError);
  },
);

test.each(kinds)(
  "%s Node update ignores even malformed manifests",
  async (kind) => {
    const input = mockDirectory(new Map([["manifest.yml", "app: [broken\n"]]));
    const output = await runUpdate(capabilityOf(kind, "node"), input);
    expect(await output.file("manifest.yml").contents()).toBe("app: [broken\n");
  },
);

test("scaffold merge removes only the Node engine and drops empty engines", () => {
  for (const engines of [{ node: ">=22" }, { node: ">=22", npm: ">=10" }]) {
    const output = JSON.parse(
      mergeScaffoldPackage(JSON.stringify({ engines, kept: true }), "{}"),
    );
    expect(output.engines).toEqual(
      "npm" in engines ? { npm: ">=10" } : undefined,
    );
    expect(output.kept).toBe(true);
  }
});

test("validation skips missing .nvmrc without contacting an engine", async () => {
  const validate = verb(capabilityOf("library", "node"), "validate");
  expect(await validate(mockDirectory())).toEqual({
    status: "skipped",
    reason: ".nvmrc is missing",
  });
});

test.each(["linux/amd64", "linux/arm64"])(
  "%s validator isolates .nvmrc and exercises fnm rather than baseline compliance",
  async (platform) => {
    const input = mockDirectory(
      new Map([
        [".nvmrc", "22\n"],
        [".node-version", "20\n"],
        ["package.json", '{"engines":{"node":"20"}}'],
      ]),
    );
    const before = [...input.files];
    const {
      container,
      commands,
      copied,
      environment,
      spy: containerSpy,
    } = mockContainer({ stdout: () => "Using Node v22.0.0\n" });
    const platformSpy = spyOn(dag, "defaultPlatform").mockResolvedValue(
      platform as never,
    );
    const httpSpy = spyOn(dag, "http").mockReturnValue({} as never);
    try {
      const validate = verb(capabilityOf("library", "node"), "validate");
      expect(await validate(input)).toEqual({ status: "validated" });
      expect(httpSpy).toHaveBeenCalledWith(
        `https://github.com/Schniz/fnm/releases/download/v${TOOL_VERSIONS.fnm}/${platform.endsWith("amd64") ? "fnm-linux" : "fnm-arm64"}.zip`,
      );
      expect(copied).toEqual(["/tmp/fnm.zip", "/repo/.nvmrc"]);
      expect(environment.FNM_RESOLVE_ENGINES).toBe("false");
      expect(environment.FNM_VERSION_FILE_STRATEGY).toBe("local");
      expect(commands.at(-1)).toEqual([
        "bash",
        "-ec",
        'eval "$(fnm env --shell bash)"; fnm use --install-if-missing',
      ]);
      expect([...input.files]).toEqual(before);
      const failure = spyOn(container, "stdout").mockRejectedValue(
        new Error("fnm: version unavailable"),
      );
      await expect(validate(input)).rejects.toThrow("fnm: version unavailable");
      failure.mockRejectedValue(
        Object.assign(new Error("exit code: 1"), {
          stderr: "error: Can't install Node v999999\n",
        }),
      );
      await expect(validate(input)).rejects.toThrow(
        "node: fnm validation execution failed: error: Can't install Node v999999",
      );
      failure.mockRestore();
    } finally {
      containerSpy.mockRestore();
      httpSpy.mockRestore();
      platformSpy.mockRestore();
    }
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s Node pulls catalog license, preserving other package values and catalog bytes",
  async (kind) => {
    const pkg = {
      license: "MIT",
      custom: { kept: true },
      scripts: { custom: "echo kept" },
      devDependencies: { kept: "1" },
    };
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        ["catalog-info.yaml", licenseCatalog],
      ]),
    );
    const output = await runUpdate(capabilityOf(kind, "node"), input);
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      ...pkg,
      license: "Apache-2.0",
    });
    expect(await output.file("catalog-info.yaml").contents()).toBe(
      licenseCatalog,
    );
    expect(await runUpdate(capabilityOf(kind, "node"), output)).toBe(output);
    expect(await input.file("package.json").contents()).toBe(
      JSON.stringify(pkg),
    );
  },
);

test("Node adds a missing package license from catalog without adding dependencies", async () => {
  const output = await runUpdate(
    capabilityOf("tool", "node"),
    mockDirectory(
      new Map([
        ["package.json", "{}"],
        ["catalog-info.yaml", licenseCatalog],
      ]),
    ),
  );
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    license: "Apache-2.0",
  });
});

test.each([
  undefined,
  "[broken",
  "metadata: {}\nmetadata: {}\n",
  "metadata: {}\n",
  "metadata:\n  annotations:\n    forge-ranch/license: 42\n",
  "metadata:\n  annotations:\n    forge-ranch/license: ' '\n",
])(
  "Node fails clearly on missing or malformed license metadata: %j",
  async (contents) => {
    const files = new Map([["package.json", "{}"]]);
    if (contents !== undefined) files.set("catalog-info.yaml", contents);
    await expect(
      runUpdate(capabilityOf("tool", "node"), mockDirectory(files)),
    ).rejects.toThrow("catalog-info.yaml");
  },
);

test("Node does not require catalog or create package.json when package is absent", async () => {
  const output = await runUpdate(capabilityOf("tool", "node"), mockDirectory());
  expect(await output.exists("package.json")).toBe(false);
});
