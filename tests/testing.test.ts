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
  expect(forge.templates.map((template) => template.path)).toContain(
    "templates/vitest",
  );
  expect(forge.files.has("vitest.config.ts")).toBe(false);
  for (const kind of ["library", "tool", "agent-skill"]) {
    expect(
      buildProject(kind, "sample", "tester").templates.map(
        (template) => template.path,
      ),
    ).not.toContain("templates/vitest");
  }
});

test.each(["library", "tool", "agent-skill"])(
  "%s leaves Bun test scripts to update without seeding a runner dependency or config",
  (kind) => {
    const { packageJson, files } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.test).toBeUndefined();
    expect(packageJson.scripts["test:watch"]).toBeUndefined();
    expect(packageJson.scripts["test:coverage"]).toBeUndefined();
    expect(packageJson.devDependencies.vitest).toBeUndefined();
    expect(files.has("vitest.config.ts")).toBe(false);
    expect(files.has("bunfig.toml")).toBe(false);
  },
);
