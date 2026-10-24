import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { LINT_COMMAND } from "../../src/capabilities/lint.ts";
import {
  AST_GREP_PACKAGE,
  PRELINT_COMMAND,
  PRELINT_PACKAGE,
  PRELINT_SCRIPTS,
  prelint,
} from "../../src/capabilities/prelint.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { isBunKind } from "../support/kinds.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const updateReason =
  "Prelint owns no files; its package.json contribution enforces the lint subtasks and keeps the seeded ast-grep dependency fresh; the @forge-ahead/prelint GitHub reference is owner-managed.";
const validationReason =
  "Prelint has no repository-local configuration to validate; its rules ship in the dependency package. Source scanning belongs to the lint workflow.";

test("prelint init and validate are explicit no-ops with enumerable reasons", () => {
  const capability = prelint();
  expect(noOpReasons([capability])).toEqual([
    {
      capability: "prelint",
      verb: "init",
      reason:
        "Prelint has no repository-local configuration to seed; its rules ship in the dependency package, and its package.json contribution supplies the tool dependencies and scripts.",
    },
    {
      capability: "prelint",
      verb: "update",
      reason: updateReason,
    },
    { capability: "prelint", verb: "validate", reason: validationReason },
  ]);
  const project = buildProject("forge-app", "sample", "tester");
  // Init shows the contribution's full intent: seed, then policy.
  expect(project.packageJson.scripts).toMatchObject(PRELINT_SCRIPTS);
  expect(project.packageJson.devDependencies[AST_GREP_PACKAGE]).toBe(
    TOOL_VERSIONS.astGrep,
  );
  expect(project.packageJson.devDependencies[PRELINT_PACKAGE]).toBe(
    TOOL_VERSIONS.forgePrelint,
  );
  expect(project.templates.some(({ path }) => path.includes("prelint"))).toBe(
    false,
  );
});

test("update enforces selected dependencies and scripts while preserving unrelated values and files", async () => {
  const capability = prelint();
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: {
            "lint:check:prelint": "ast-grep scan owner",
            "lint:check:forge": "owner forge",
            lint: "owner lint",
            custom: "keep",
          },
          devDependencies: {
            [AST_GREP_PACKAGE]: "0.0.1",
            [PRELINT_PACKAGE]: "github:example/rules#revision",
            custom: "1",
          },
          dependencies: { keep: "1" },
          custom: { keep: true },
        }),
      ],
      ["lefthook.yml", "owner config, even invalid\r\n"],
      ["sgconfig.yml", "owner rules"],
      ["src/index.ts", "owner source\n"],
      ["package-lock.json", "owner lock"],
      ["bun.lock", "owner bun lock"],
    ]),
  );
  const before = [...input.files];
  const output = await updateCapabilities(input, [capability]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    name: "owner",
    scripts: { ...PRELINT_SCRIPTS, lint: "owner lint", custom: "keep" },
    devDependencies: {
      [AST_GREP_PACKAGE]: TOOL_VERSIONS.astGrep,
      [PRELINT_PACKAGE]: "github:example/rules#revision",
      custom: "1",
    },
    dependencies: { keep: "1" },
    custom: { keep: true },
  });
  expect(PRELINT_COMMAND).toBe(
    "ast-grep scan --globs '!specs/**' --globs '!node_modules/**' --config ./node_modules/@forge-ahead/prelint/sgconfig.ecosol.yml",
  );
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await updateCapabilities(output, [capability])).toBe(output);
});

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s initialization and composed update keep prelint Forge-only and idempotent",
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
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts.lint).toBe(
        isBunKind(kind)
          ? LINT_COMMAND.replace("--npm-path npm", "--npm-path bun")
          : LINT_COMMAND,
      );
      if (kind === "forge-app") {
        expect(pkg.scripts["lint:check:prelint"]).toBe(PRELINT_COMMAND);
        expect(pkg.scripts["lint:check:forge"]).toBe("forge lint");
        expect(pkg.devDependencies[AST_GREP_PACKAGE]).toBe(
          TOOL_VERSIONS.astGrep,
        );
        expect(pkg.devDependencies[PRELINT_PACKAGE]).toBe(
          TOOL_VERSIONS.forgePrelint,
        );
      } else {
        expect(pkg.scripts["lint:check:prelint"]).toBeUndefined();
        expect(pkg.scripts["lint:check:forge"]).toBeUndefined();
        expect(pkg.devDependencies[AST_GREP_PACKAGE]).toBeUndefined();
        expect(pkg.devDependencies[PRELINT_PACKAGE]).toBeUndefined();
      }
      expect(await module.update(initialized, kind)).toBe(initialized);
      Object.assign(pkg.scripts, {
        "lint:check:prelint": "owner prelint",
        "lint:check:forge": "owner forge",
      });
      Object.assign(pkg.devDependencies, {
        [AST_GREP_PACKAGE]: "0.0.1",
        [PRELINT_PACKAGE]: "0.0.1",
      });
      const edited = initialized
        .withNewFile("package.json", JSON.stringify(pkg))
        .withNewFile("lefthook.yml", "owner hooks\r\n");
      const updated = await module.update(edited, kind);
      const actual = JSON.parse(await updated.file("package.json").contents());
      expect(actual.scripts["lint:check:prelint"]).toBe(
        kind === "forge-app" ? PRELINT_COMMAND : "owner prelint",
      );
      expect(actual.scripts["lint:check:forge"]).toBe(
        kind === "forge-app" ? "forge lint" : "owner forge",
      );
      expect(actual.devDependencies[AST_GREP_PACKAGE]).toBe(
        kind === "forge-app" ? TOOL_VERSIONS.astGrep : "0.0.1",
      );
      expect(actual.devDependencies[PRELINT_PACKAGE]).toBe("0.0.1");
      expect(await updated.file("lefthook.yml").contents()).toBe(
        "owner hooks\r\n",
      );
      expect(await module.update(updated, kind)).toBe(updated);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("capability and standalone validation skip without reading files or starting containers", async () => {
  const input = mockDirectory(
    new Map([
      ["package.json", "malformed"],
      ["src/index.ts", "rule violations"],
    ]),
  );
  const before = [...input.files];
  const read = spyOn(input, "exists").mockImplementation(() => {
    throw new Error("Validation must not read the repository");
  });
  const file = spyOn(input, "file").mockImplementation(() => {
    throw new Error("Validation must not read files");
  });
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("Validation must not install tools or scan source");
  });
  try {
    const skipped = { status: "skipped", reason: validationReason } as const;
    expect(await validateCapabilities(input, [prelint()])).toEqual([
      { capability: "prelint", ...skipped },
    ]);
    expect(read).not.toHaveBeenCalled();
    expect(file).not.toHaveBeenCalled();
    expect(container).not.toHaveBeenCalled();
    expect([...input.files]).toEqual(before);
  } finally {
    container.mockRestore();
    file.mockRestore();
    read.mockRestore();
  }
});

test("Forge blueprints carry API types as seed and errors and logging as policy", () => {
  const pkg = buildProject("forge-app", "sample", "tester").packageJson;
  expect(pkg.dependencies).toEqual({
    "@forge-ahead/atlassian-api-types": TOOL_VERSIONS.forgeAheadApiTypes,
    "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
    "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
  });
  for (const kind of ["library", "tool", "agent-skill"]) {
    expect(
      buildProject(kind, "sample", "tester").packageJson.dependencies,
    ).toBeUndefined();
  }
});
