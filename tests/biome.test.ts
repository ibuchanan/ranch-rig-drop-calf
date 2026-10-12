import { expect, test } from "bun:test";
import { BIOME_SCRIPTS, biomeToolchain } from "../src/biome.ts";
import { validateCapabilities } from "../src/capability.ts";
import { ParseError } from "../src/errors.ts";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { runUpdate, verb } from "./capability-fixtures.ts";
import { mockContainer } from "./container-source.ts";
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
    const { spy, commands } = mockContainer();
    try {
      expect(await runUpdate(biomeToolchain(), input)).toBe(input);
      expect(await runUpdate(biomeToolchain(), input)).toBe(input);
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
    const { spy, reads } = mockContainer({ transform: () => migrated });
    try {
      const output = await runUpdate(biomeToolchain(), input);
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
      expect(await runUpdate(biomeToolchain(), output)).toBe(output);
      expect(reads).toEqual([`/repo/${path}`, `/repo/${path}`]);
      expect([...input.files]).toEqual(before);
    } finally {
      spy.mockRestore();
    }
  },
);

test("update seeds missing package sections but never missing config or EditorConfig", async () => {
  const { spy, commands } = mockContainer();
  try {
    const output = await runUpdate(
      biomeToolchain(),
      mockDirectory(new Map([["package.json", "{}"]])),
    );
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      scripts: BIOME_SCRIPTS,
    });
    expect(await output.exists("biome.jsonc")).toBe(false);
    expect(await output.exists(".editorconfig")).toBe(false);
    expect(commands).toEqual([]);
  } finally {
    spy.mockRestore();
  }
});

test.each(["{", "[]", "null"])(
  "update rejects malformed config before invoking migration: %s",
  async (contents) => {
    const { spy, commands } = mockContainer();
    try {
      await expect(
        runUpdate(
          biomeToolchain(),
          mockDirectory(new Map([["biome.jsonc", contents]])),
        ),
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
      [
        "package.json",
        JSON.stringify({ devDependencies: { "@biomejs/biome": "0.0.1" } }),
      ],
    ]),
  );
  const { spy, reads, commands } = mockContainer();
  try {
    const output = await runUpdate(biomeToolchain(), input);
    expect(
      JSON.parse(await output.file("package.json").contents()).devDependencies[
        "@biomejs/biome"
      ],
    ).toBe(TOOL_VERSIONS.biome);
    expect(await output.file("biome.jsonc").contents()).toBe(
      "{ malformed unselected config",
    );
    expect(reads).toEqual(["/repo/biome.json"]);
    expect(await verb(biomeToolchain(), "validate")(input)).toEqual({
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
        .every((args) =>
          args.includes(`@biomejs/biome@${TOOL_VERSIONS.biome}`),
        ),
    ).toBe(true);
  } finally {
    spy.mockRestore();
  }
});

test("standalone validation skips a missing config without starting a container", async () => {
  const { spy } = mockContainer();
  try {
    expect(await verb(biomeToolchain(), "validate")(mockDirectory())).toEqual({
      status: "skipped",
      reason: "biome.json and biome.jsonc are missing",
    });
    expect(spy).not.toHaveBeenCalled();
  } finally {
    spy.mockRestore();
  }
});

test("validation uses the capability pin, read-only mount, and config-only command with no source checks", async () => {
  const { spy, mounts, commands, reads } = mockContainer();
  const input = mockDirectory(
    new Map([
      ["biome.jsonc", "{}"],
      ["bad.ts", "invalid source"],
    ]),
  );
  const before = [...input.files];
  try {
    const capability = biomeToolchain();
    expect(await validateCapabilities(input, [capability])).toEqual([
      { capability: "biome", status: "validated" },
    ]);
    expect(commands[0]).toEqual([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `@biomejs/biome@${TOOL_VERSIONS.biome}`,
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
  const { spy } = mockContainer({ failure });
  const input = mockDirectory(new Map([["biome.jsonc", "{}"]]));
  try {
    await expect(runUpdate(biomeToolchain(), input)).rejects.toThrow(
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
