import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { updateCapabilities, validateCapabilities } from "../src/capability.ts";
import {
  DOCS_COMMAND,
  DOCS_CONFIGS,
  DOCS_TEMPLATE,
  docsLinting,
} from "../src/docs.ts";
import { DropCalf } from "../src/index.ts";
import { createBlueprint } from "../src/project.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { runInit, runUpdate, verb } from "./capability-fixtures.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { docsTemplates } from "./templates-source.ts";

test("init declares its template tree and selected tools without authoring docs", () => {
  const capability = docsLinting();
  const project = createBlueprint("sample", "", "tester");
  if (typeof capability.init !== "function") throw new Error("missing init");
  runInit(capability, project);
  expect(project.templates.map((template) => template.path)).toEqual([
    DOCS_TEMPLATE,
  ]);
  expect(project.files.size).toBe(0);
  expect(project.packageJson.scripts["lint:docs"]).toBe(DOCS_COMMAND);
  expect(project.packageJson.devDependencies).toEqual({
    cspell: TOOL_VERSIONS.cspell,
    "markdownlint-cli2": TOOL_VERSIONS.markdownlintCli2,
  });
});

test("update maintains only docs tools and script, preserving owner words, prose, configs and lockfiles", async () => {
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: { "lint:docs": "owner command", lint: "owner lint" },
          devDependencies: {
            cspell: "0.0.1",
            "markdownlint-cli2": "0.0.1",
            owner: "1",
          },
          dependencies: { keep: "1" },
          custom: { keep: true },
        }),
      ],
      [
        ".cspell.jsonc",
        '{\r\n  // owner vocabulary\r\n  "words": ["myprojectword"]\r\n}\r\n',
      ],
      [".markdownlint-cli2.jsonc", "owner config, even if invalid"],
      ["DEVELOPMENT.md", "# Owner workflow\r\n"],
      ["docs/tutorials/tutorial.md", "# Written tutorial\n"],
      ["specs/spec.md", "# Actual spec\n"],
      ["bun.lock", "owner lock"],
    ]),
  );
  const before = [...input.files];
  const capability = docsLinting();
  const output = await updateCapabilities(input, [capability]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    name: "owner",
    scripts: { "lint:docs": DOCS_COMMAND, lint: "owner lint" },
    devDependencies: {
      cspell: TOOL_VERSIONS.cspell,
      "markdownlint-cli2": TOOL_VERSIONS.markdownlintCli2,
      owner: "1",
    },
    dependencies: { keep: "1" },
    custom: { keep: true },
  });
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await updateCapabilities(output, [capability])).toBe(output);
});

test("update creates missing scripts but never re-adds removed seed dependencies", async () => {
  const empty = mockDirectory();
  expect(await runUpdate(docsLinting(), empty)).toBe(empty);
  const output = await runUpdate(
    docsLinting(),
    mockDirectory(new Map([["package.json", "{}"]])),
  );
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg).toEqual({
    scripts: { "lint:docs": DOCS_COMMAND },
  });
  for (const path of docsTemplates().keys())
    expect(await output.exists(path)).toBe(false);
  const text = `${JSON.stringify(pkg, null, 4)}\r\n`;
  const matching = output.withNewFile("package.json", text);
  expect(await runUpdate(docsLinting(), matching)).toBe(matching);
  expect(await matching.file("package.json").contents()).toBe(text);
});

test.each([
  "{",
  "null",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"devDependencies":"bad"}',
  '{"devDependencies":null}',
])(
  "update rejects unsafe package input without writes: %s",
  async (contents) => {
    const input = mockDirectory(new Map([["package.json", contents]]));
    await expect(runUpdate(docsLinting(), input)).rejects.toThrow(
      "package.json",
    );
    expect(await input.file("package.json").contents()).toBe(contents);
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s composed init seeds docs and update preserves owner edits and intentional deletion",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      for (const [path, text] of docsTemplates())
        expect(await initialized.file(path).contents()).toBe(text);
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      pkg.scripts["lint:docs"] = "owner command";
      pkg.devDependencies.cspell = "0.0.1";
      pkg.devDependencies["markdownlint-cli2"] = "0.0.1";
      let edited = initialized.withNewFile("package.json", JSON.stringify(pkg));
      for (const path of docsTemplates().keys())
        edited = edited.withNewFile(path, `owner bytes: ${path}\r\n`);
      const output = await module.update(edited, kind);
      for (const path of docsTemplates().keys())
        expect(await output.file(path).contents()).toBe(
          `owner bytes: ${path}\r\n`,
        );
      const updated = JSON.parse(await output.file("package.json").contents());
      expect(updated.scripts["lint:docs"]).toBe(DOCS_COMMAND);
      expect(updated.devDependencies.cspell).toBe(TOOL_VERSIONS.cspell);
      expect(updated.devDependencies["markdownlint-cli2"]).toBe(
        TOOL_VERSIONS.markdownlintCli2,
      );
      expect(await module.update(output, kind)).toBe(output);
      let deleted = output;
      for (const path of docsTemplates().keys())
        deleted = deleted.withoutFile(path);
      expect(await module.update(deleted, kind)).toBe(deleted);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("validation uses selected tools and content-free commands with a read-only repository", async () => {
  const input = mockDirectory(
    new Map([
      ...docsTemplates(),
      ["README.md", "bad spelling and Markdown"],
      ["package.json", "invalid package"],
    ]),
  );
  const before = [...input.files];
  const { commands, mounts, mounted, spy } = mockContainer();
  try {
    expect(await validateCapabilities(input, [docsLinting()])).toEqual([
      { capability: "docs", status: "validated" },
    ]);
    expect(commands).toEqual([
      [
        "bun",
        "add",
        "--ignore-scripts",
        `cspell@${TOOL_VERSIONS.cspell}`,
        `markdownlint-cli2@${TOOL_VERSIONS.markdownlintCli2}`,
      ],
      [
        "bun",
        "run",
        "--no-install",
        "/tools/node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs",
        "--config",
        DOCS_CONFIGS[0],
        "--no-globs",
        "**/*.md",
        "#**",
      ],
      [
        "bun",
        "run",
        "--no-install",
        "/tools/node_modules/cspell/bin.mjs",
        "lint",
        "--config",
        DOCS_CONFIGS[1],
        "--no-config-search",
        "--no-must-find-files",
        "--no-progress",
        "--exclude",
        "**",
        "**/*.md",
      ],
    ]);
    expect(mounts).toEqual([{ path: "/repo", readOnly: true }]);
    expect(mounted).toEqual([input]);
    expect([...input.files]).toEqual(before);
  } finally {
    spy.mockRestore();
  }
});

test("validation skips an absent pair and fails a partial pair before installing tools", async () => {
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("must not install");
  });
  try {
    expect(await verb(docsLinting(), "validate")(mockDirectory())).toEqual({
      status: "skipped",
      reason: ".markdownlint-cli2.jsonc and .cspell.jsonc are missing",
    });
    for (const path of DOCS_CONFIGS) {
      const result = await verb(
        docsLinting(),
        "validate",
      )(mockDirectory(new Map([[path, "{}"]])));
      expect(result.status).toBe("failed");
      expect("reason" in result && result.reason).toContain(
        path === DOCS_CONFIGS[0] ? DOCS_CONFIGS[1] : DOCS_CONFIGS[0],
      );
    }
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});

test("validation reports tool diagnostics without changing config", async () => {
  const input = mockDirectory(docsTemplates());
  const failure = Object.assign(new Error("exec failed"), {
    stdout: "configuration load",
    stderr: "Unable to parse JSONC content",
  });
  const { spy } = mockContainer({ failure });
  try {
    expect(await validateCapabilities(input, [docsLinting()])).toEqual([
      {
        capability: "docs",
        status: "failed",
        reason:
          "docs: validation execution failed: configuration load\nUnable to parse JSONC content",
      },
    ]);
  } finally {
    spy.mockRestore();
  }
});
