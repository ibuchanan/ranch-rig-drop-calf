import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { gitHooksTemplates } from "./templates-source.ts";

test("Forge apps expose Vitest test, watch and coverage commands on an empty starter", () => {
  const { packageJson } = buildProject("forge-app", "sample", "tester");
  expect(packageJson.scripts.test).toBe("vitest run --passWithNoTests");
  expect(packageJson.scripts["test:watch"]).toBe(
    "vitest watch --passWithNoTests",
  );
  expect(packageJson.scripts["test:coverage"]).toBe(
    "vitest run --coverage --passWithNoTests",
  );
  expect(packageJson.devDependencies.vitest).toBe("5.0.3");
  expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBe("5.0.3");
});

test("Forge pre-push checks reach the typecheck command through lint", () => {
  const { scripts } = buildProject("forge-app", "sample", "tester").packageJson;
  const hooks = Bun.YAML.parse(
    gitHooksTemplates().get("lefthook.yml") ?? "",
  ) as {
    "pre-push": { commands: { lint: { run: string } } };
    lint: { commands: { typecheck: { run: string } } };
  };
  expect(hooks["pre-push"].commands.lint.run).toBe("npm run lint --if-present");
  expect(scripts.lint).toBe("lefthook run lint");
  expect(hooks.lint.commands.typecheck.run).toBe(
    "npm run typecheck --if-present",
  );
  expect(scripts.typecheck).toBe(
    "tsc --project tsconfig.typecheck.json --noEmit",
  );
});

test("only Forge apps declare a Vitest template, without embedding config in the blueprint", () => {
  const forge = buildProject("forge-app", "sample", "tester");
  expect(forge.templates).toContain("templates/vitest");
  expect(forge.files.has("vitest.config.ts")).toBe(false);
  for (const kind of ["library", "tool", "agent-skill"]) {
    expect(buildProject(kind, "sample", "tester").templates).not.toContain(
      "templates/vitest",
    );
  }
});

test("library and tool keep Bun test, watch and coverage commands; agent skills have none", () => {
  for (const kind of ["library", "tool"]) {
    const { packageJson, files } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.test).toBe("bun test --pass-with-no-tests");
    expect(packageJson.scripts["test:watch"]).toBe(
      "bun test --watch --pass-with-no-tests",
    );
    expect(packageJson.scripts["test:coverage"]).toBe(
      "bun test --coverage --pass-with-no-tests",
    );
    expect(packageJson.devDependencies.vitest).toBeUndefined();
    expect(files.has("vitest.config.ts")).toBe(false);
  }
  const agent = buildProject("agent-skill", "sample", "tester");
  expect(
    Object.keys(agent.packageJson.scripts).filter((key) =>
      key.startsWith("test"),
    ),
  ).toEqual([]);
});
