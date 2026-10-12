import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { ParseError } from "../src/errors.ts";
import { NODE_NVMRC, NPMRC } from "../src/node.ts";
import { mergeScaffoldPackage } from "../src/package-json.ts";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { capabilityOf, runUpdate, verb } from "./capability-fixtures.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory } from "./module-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];
const licenseCatalog =
  "metadata:\n  annotations:\n    forge-ranch/license: Apache-2.0\n";

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
      devDependencies: { "@types/node": "24", unrelated: "1" },
    };
    const { engines: _engines, ...withoutEngines } = expectedPkg;
    expect(result).toEqual(kind === "forge-app" ? withoutEngines : expectedPkg);
    expect(await output.file(".nvmrc").contents()).toBe(NODE_NVMRC);
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
