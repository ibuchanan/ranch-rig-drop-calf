import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  PRELINT_COMMAND,
  PRELINT_SCAN,
  prelint,
  validatePrelint,
} from "../src/prelint.ts";
import { buildProject } from "../src/profiles.ts";

test("Forge projects run prelint, Biome and Forge lint through the direct lint script", () => {
  const pkg = buildProject("forge-app", "sample", "tester").packageJson;
  expect(pkg.devDependencies["@ast-grep/cli"]).toBe("^0.45");
  expect(pkg.devDependencies["@forge-ahead/prelint"]).toBe(
    "github:ibuchanan/tool-forge-prelint-ast-grep",
  );
  expect(pkg.scripts["lint:prelint"]).toBe(PRELINT_COMMAND);
  expect(PRELINT_COMMAND).toBe(
    "ast-grep scan --globs '!specs/**' --globs '!node_modules/**' --config ./node_modules/@forge-ahead/prelint/sgconfig.ecosol.yml",
  );
  expect(pkg.scripts["lint:forge"]).toBe("forge lint");
  expect(pkg.scripts.lint).toBe("lefthook run lint");
});

test("Forge projects include only the three Forge Ahead runtime dependencies", () => {
  const pkg = buildProject("forge-app", "sample", "tester").packageJson;
  expect(pkg.dependencies).toEqual({
    "@forge-ahead/atlassian-api-types":
      "github:ibuchanan/forge-ahead-atlassian-api-types",
    "@forge-ahead/errors": "github:ibuchanan/forge-ahead-errors",
    "@forge-ahead/logging": "github:ibuchanan/forge-ahead-logging",
  });
  for (const kind of ["library", "tool", "agent-skill"]) {
    const other = buildProject(kind, "sample", "tester").packageJson;
    expect(other.dependencies).toBeUndefined();
    expect(other.devDependencies["@ast-grep/cli"]).toBeUndefined();
    expect(other.devDependencies["@forge-ahead/prelint"]).toBeUndefined();
    expect(other.scripts["lint:prelint"]).toBeUndefined();
  }
});

test("the prelint capability is a no-op until it is composed into a kind", () => {
  const project = buildProject("tool", "sample", "tester");
  expect(project.packageJson.scripts["lint:prelint"]).toBeUndefined();
  prelint().addTo(project);
  expect(project.packageJson.scripts["lint:prelint"]).toBe(PRELINT_COMMAND);
});

/**
 * Stand in for `dag.container()` so the validation paths are exercised without
 * an engine. `outputs` maps a shell command to what the container writes back.
 */
function mockContainer(outputs: Record<string, string>) {
  const commands: string[][] = [];
  const container = {
    from: () => container,
    withNewFile: () => container,
    withWorkdir: () => container,
    withExec: (args: string[]) => {
      commands.push(args);
      return container;
    },
    withMountedDirectory: () => container,
    stdout: async () => outputs[commands.at(-1)?.join(" ") ?? ""] ?? "",
  };
  return {
    commands,
    spy: spyOn(dag, "container").mockReturnValue(container as never),
  };
}

const directory = (manifest: Record<string, unknown> | undefined) =>
  ({
    exists: async () => manifest !== undefined,
    file: () => ({ contents: async () => JSON.stringify(manifest ?? {}) }),
  }) as unknown as Parameters<typeof validatePrelint>[0];

test("validation skips a repository that never opted into prelint", async () => {
  const { spy } = mockContainer({});
  try {
    expect(await validatePrelint(directory(undefined))).toEqual({
      status: "skipped",
      reason: "package.json is missing",
    });
    expect(
      await validatePrelint(directory({ name: "sample", scripts: {} })),
    ).toEqual({ status: "skipped", reason: "lint:prelint is missing" });
  } finally {
    spy.mockRestore();
  }
});

test("validation installs the pinned rules and runs the scan", async () => {
  const { commands, spy } = mockContainer({
    [`sh -c ${PRELINT_SCAN} 2>&1; echo "ast-grep exit=$?"`]: "ast-grep exit=0",
  });
  try {
    expect(
      await validatePrelint(
        directory({
          name: "sample",
          scripts: { "lint:prelint": PRELINT_COMMAND },
        }),
      ),
    ).toEqual({ status: "validated" });
    expect(commands[0]).toEqual(["npm", "install", "--no-fund", "--no-audit"]);
    expect(commands.at(-1)).toEqual([
      "sh",
      "-c",
      `${PRELINT_SCAN} 2>&1; echo "ast-grep exit=$?"`,
    ]);
  } finally {
    spy.mockRestore();
  }
});

test("validation reports the scan's own output when a rule fails", async () => {
  const { spy } = mockContainer({
    [`sh -c ${PRELINT_SCAN} 2>&1; echo "ast-grep exit=$?"`]:
      "error: rule matched\nast-grep exit=1",
  });
  try {
    await expect(
      validatePrelint(
        directory({
          name: "sample",
          scripts: { "lint:prelint": PRELINT_COMMAND },
        }),
      ),
    ).rejects.toThrow(/ast-grep validation failed: error: rule matched/);
  } finally {
    spy.mockRestore();
  }
});
