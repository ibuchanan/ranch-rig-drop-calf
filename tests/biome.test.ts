import { expect, test } from "bun:test";
import {
  BIOME_SCRIPTS,
  biomeToolchain,
  updateBiome,
  validateBiome,
} from "../src/biome.ts";
import { validateCapabilities } from "../src/capability.ts";
import { ParseError } from "../src/preclean.ts";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockBiomeContainer } from "./biome-source.ts";
import { mockDirectory } from "./module-source.ts";
import { biomeTemplates } from "./templates-source.ts";

const kinds = ["library", "forge-app", "tool", "agent-skill"];

test.each(kinds)(
  "%s Biome verbs preserve a freshly initialized repository byte-exact",
  async (kind) => {
    const capability = biomeToolchain();
    expect(typeof capability.init).toBe("function");
    expect(typeof capability.update).toBe("function");
    expect(typeof capability.validate).toBe("function");
    const project = buildProject(kind, "sample", "tester");
    const input = mockDirectory(
      new Map([
        ...biomeTemplates(),
        ["package.json", JSON.stringify(project.packageJson)],
      ]),
    );
    const { spy, commands } = mockBiomeContainer();
    try {
      expect(await updateBiome(input)).toBe(input);
      expect(await updateBiome(input)).toBe(input);
      expect(commands).toContainEqual([
        "biome",
        "migrate",
        "--write",
        "--config-path=biome.jsonc",
        "--colors=off",
      ]);
    } finally {
      spy.mockRestore();
    }
  },
);

test.each(["biome.json", "biome.jsonc"])(
  "update migrates only %s and owned package keys, preserving owner files",
  async (path) => {
    const original =
      '{\n // owner comment\n "$schema": "https://biomejs.dev/schemas/2.5.13/schema.json",\n "formatter": {"indentStyle":"tab"}\n}\n';
    const migrated = original.replace("2.5.13", TOOL_VERSIONS.biome);
    const pkg = {
      name: "owner",
      devDependencies: { "@biomejs/biome": "2.5.13", unrelated: "1" },
      dependencies: { kept: "2" },
      scripts: { format: "custom", lint: "owner lint", custom: "echo kept" },
      custom: { keep: true },
    };
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        [path, original],
        [".editorconfig", "[*]\nindent_style = tab\n"],
        ["base.jsonc", "owner base config"],
        ["owner.ts", "owner source"],
      ]),
    );
    const before = [...input.files];
    const { spy, reads } = mockBiomeContainer(() => migrated);
    try {
      const output = await updateBiome(input);
      expect(JSON.parse(await output.file("package.json").contents())).toEqual({
        ...pkg,
        devDependencies: {
          ...pkg.devDependencies,
          "@biomejs/biome": TOOL_VERSIONS.biome,
        },
        scripts: { ...pkg.scripts, ...BIOME_SCRIPTS },
      });
      expect(await output.file(path).contents()).toBe(migrated);
      for (const owner of [".editorconfig", "base.jsonc", "owner.ts"])
        expect(await output.file(owner).contents()).toBe(
          input.files.get(owner) ?? "",
        );
      expect(await updateBiome(output)).toBe(output);
      expect(reads).toEqual([`/repo/${path}`, `/repo/${path}`]);
      expect([...input.files]).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  },
);

test("update seeds missing package sections but never missing package, config, or EditorConfig", async () => {
  const { spy, commands } = mockBiomeContainer();
  try {
    const empty = mockDirectory();
    expect(await updateBiome(empty)).toBe(empty);
    const output = await updateBiome(
      mockDirectory(new Map([["package.json", "{}"]])),
    );
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      devDependencies: { "@biomejs/biome": TOOL_VERSIONS.biome },
      scripts: BIOME_SCRIPTS,
    });
    expect(await output.exists("biome.jsonc")).toBe(false);
    expect(await output.exists(".editorconfig")).toBe(false);
    expect(await updateBiome(output)).toBe(output);
    expect(commands).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

test.each([
  "{",
  "[]",
  "null",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"devDependencies":"bad"}',
])("update rejects malformed shared package: %s", async (contents) => {
  await expect(
    updateBiome(mockDirectory(new Map([["package.json", contents]]))),
  ).rejects.toThrow(ParseError);
});

test.each(["{", "[]", "null"])(
  "update rejects malformed config before invoking migration: %s",
  async (contents) => {
    const { spy, commands } = mockBiomeContainer();
    try {
      await expect(
        updateBiome(mockDirectory(new Map([["biome.jsonc", contents]]))),
      ).rejects.toThrow(ParseError);
      expect(commands).toEqual([]);
    } finally {
      spy.mockRestore();
    }
  },
);

test("root JSON takes precedence over JSONC and custom pins apply to both update and validation", async () => {
  const input = mockDirectory(
    new Map([
      ["biome.json", '{"formatter":{"indentStyle":"tab"}}'],
      ["biome.jsonc", "{ malformed unselected config"],
      ["package.json", "{}"],
    ]),
  );
  const { spy, reads, commands } = mockBiomeContainer();
  try {
    const output = await updateBiome(input, "2.5.13");
    expect(
      JSON.parse(await output.file("package.json").contents()).devDependencies[
        "@biomejs/biome"
      ],
    ).toBe("2.5.13");
    expect(await output.file("biome.jsonc").contents()).toBe(
      "{ malformed unselected config",
    );
    expect(reads).toEqual(["/repo/biome.json"]);
    expect(await validateBiome(input, "2.5.13")).toEqual({
      status: "validated",
    });
    expect(
      commands
        .filter((args) => args[0] === "biome")
        .every((args) => args.includes("--config-path=biome.json")),
    ).toBe(true);
    expect(
      commands
        .filter((args) => args[0] === "npm")
        .every((args) => args.includes("@biomejs/biome@2.5.13")),
    ).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("standalone validation skips a missing config without starting a container", async () => {
  const { spy } = mockBiomeContainer();
  try {
    expect(await validateBiome(mockDirectory())).toEqual({
      status: "skipped",
      reason: "biome.json and biome.jsonc are missing",
    });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("validation uses the capability pin, read-only mount, and config-only command with no source checks", async () => {
  const { spy, mounts, commands, reads } = mockBiomeContainer();
  const input = mockDirectory(
    new Map([
      ["biome.jsonc", "{}"],
      ["bad.ts", "invalid source"],
    ]),
  );
  const before = [...input.files];
  try {
    const capability = biomeToolchain("2.5.13");
    expect(await validateCapabilities(input, [capability])).toEqual([
      { capability: "biome", status: "validated" },
    ]);
    expect(commands[0]).toEqual([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      "@biomejs/biome@2.5.13",
    ]);
    expect(commands.at(-1)).toEqual([
      "biome",
      "check",
      "--config-path=biome.jsonc",
      "--formatter-enabled=false",
      "--linter-enabled=false",
      "--assist-enabled=false",
      "--no-errors-on-unmatched",
      "biome.jsonc",
      "--colors=off",
    ]);
    expect(mounts).toEqual([{ path: "/repo", readOnly: true }]);
    expect(reads).toEqual([]);
    expect([...input.files]).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

test("migration and validation retain tool diagnostics without changing the input", async () => {
  const failure = Object.assign(new Error("exec failed"), {
    stderr: "unknown configuration key",
  });
  const { spy } = mockBiomeContainer(undefined, failure);
  const input = mockDirectory(new Map([["biome.jsonc", "{}"]]));
  try {
    await expect(updateBiome(input)).rejects.toThrow(
      "biome: migration execution failed: unknown configuration key",
    );
    expect(await validateCapabilities(input, [biomeToolchain()])).toEqual([
      {
        capability: "biome",
        status: "failed",
        reason: "biome: validation execution failed: unknown configuration key",
      },
    ]);
    expect(input.files.get("biome.jsonc")).toBe("{}");
  } finally {
    spy.mockRestore();
  }
});
