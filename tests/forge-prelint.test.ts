import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";

test("Forge projects run prelint, Biome and Forge lint through the direct lint script", () => {
  const pkg = buildProject("forge-app", "sample", "", "none").packageJson;
  expect(pkg.devDependencies["@ast-grep/cli"]).toBeDefined();
  expect(pkg.devDependencies["tool-forge-prelint-ast-grep"]).toBeDefined();
  expect(pkg.devDependencies["@ast-grep/cli"]).toBe("^0.44");
  expect(pkg.scripts["lint:prelint"]).toBe(
    "ast-grep scan --config node_modules/tool-forge-prelint-ast-grep/sgconfig.ecosol.yml --globs '!node_modules/**'",
  );
  expect(pkg.scripts["lint:forge"]).toBe("forge lint");
  expect(pkg.scripts.lint).toBe(
    "npm run lint:prelint && npm run lint:check && npm run lint:forge",
  );
});

test("Forge projects include only the three Forge Ahead runtime dependencies", () => {
  const pkg = buildProject("forge-app", "sample", "", "none").packageJson;
  expect(pkg.dependencies).toEqual({
    "@forge-ahead/atlassian-api-types":
      "github:ibuchanan/forge-ahead-atlassian-api-types",
    "@forge-ahead/errors": "github:ibuchanan/forge-ahead-errors",
    "@forge-ahead/logging": "github:ibuchanan/forge-ahead-logging",
  });
  for (const kind of ["library", "tool", "agent-skill"]) {
    const other = buildProject(kind, "sample", "", "none").packageJson;
    expect(other.dependencies).toBeUndefined();
    expect(other.devDependencies["@ast-grep/cli"]).toBeUndefined();
    expect(
      other.devDependencies["tool-forge-prelint-ast-grep"],
    ).toBeUndefined();
    expect(other.scripts["lint:prelint"]).toBeUndefined();
  }
});

test("Forge sync adds owned runtime dependencies and converges without losing unrelated ones", () => {
  const files = new Map([
    [
      "package.json",
      JSON.stringify({
        name: "sample",
        dependencies: { "@forge/api": "^7.0.0" },
      }),
    ],
  ]);
  const output = applySync(planSync(files, "forge-app")).files;
  const pkg = JSON.parse(output.get("package.json") ?? "null");
  expect(pkg.dependencies).toMatchObject({
    "@forge/api": "^7.0.0",
    "@forge-ahead/errors": "github:ibuchanan/forge-ahead-errors",
    "@forge-ahead/logging": "github:ibuchanan/forge-ahead-logging",
    "@forge-ahead/atlassian-api-types":
      "github:ibuchanan/forge-ahead-atlassian-api-types",
  });
  expect(planSync(output, "forge-app").operations).toEqual([]);
});

test("Forge sync rejects conflicting owned scripts and packages without changing input", () => {
  for (const section of ["scripts", "devDependencies", "dependencies"]) {
    const key =
      section === "scripts"
        ? "lint:prelint"
        : section === "devDependencies"
          ? "@ast-grep/cli"
          : "@forge-ahead/errors";
    const original = JSON.stringify({
      name: "sample",
      [section]: { [key]: "custom" },
    });
    const files = new Map([["package.json", original]]);
    expect(() => planSync(files, "forge-app")).toThrow(ConflictError);
    expect(() => planSync(files, "forge-app")).toThrow(`${section}.${key}`);
    expect(files.get("package.json")).toBe(original);
  }
});
