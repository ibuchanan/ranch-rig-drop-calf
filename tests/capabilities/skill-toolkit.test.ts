import { expect, test } from "bun:test";
import {
  SKILL_TOOLKIT_PACKAGE,
  SKILL_TOOLKIT_SCRIPTS,
  skillToolkit,
} from "../../src/capabilities/skill-toolkit.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { noOpReasons } from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";

test("skill toolkit has explicit no-op verbs with enumerable reasons", () => {
  const reasons = noOpReasons([skillToolkit()]);
  expect(reasons.map(({ verb }) => verb)).toEqual([
    "init",
    "update",
    "validate",
  ]);
  for (const { reason } of reasons) expect(reason.trim()).not.toBe("");
});

test("agent-skill seeds the toolkit reference and joins lint as a producer", () => {
  const { packageJson, templates } = buildProject(
    "agent-skill",
    "sample",
    "tester",
  );
  expect(packageJson.devDependencies[SKILL_TOOLKIT_PACKAGE]).toBe(
    TOOL_VERSIONS.agentSkillsToolkit,
  );
  expect(packageJson.scripts).toMatchObject(SKILL_TOOLKIT_SCRIPTS);
  expect(SKILL_TOOLKIT_SCRIPTS["lint:check:skills"]).toStartWith("check-skill");
  // The toolkit scaffolds skills; no capability seeds skill content.
  expect(templates.some(({ path }) => path.includes("skill-toolkit"))).toBe(
    false,
  );
});

test("only agent-skill selects the toolkit", () => {
  for (const kind of ["library", "forge-app", "tool"])
    expect(
      buildProject(kind, "sample", "tester").packageJson.devDependencies[
        SKILL_TOOLKIT_PACKAGE
      ],
    ).toBeUndefined();
});

test("agent-skill runs on Bun: stock bunfig, @types/bun, and the Bun TypeScript base", () => {
  const { packageJson, templates } = buildProject(
    "agent-skill",
    "sample",
    "tester",
  );
  const trees = templates.map(({ path }) => path);
  expect(trees).toContain("templates/bun");
  expect(trees).toContain("templates/typescript-bun");
  expect(trees).not.toContain("templates/typescript");
  expect(packageJson.devDependencies["@types/bun"]).toBe(TOOL_VERSIONS.bun);
  expect(packageJson.packageManager).toBe(`bun@${TOOL_VERSIONS.bun}`);
});

test("agent-skill offers evals as opt-in and has no secrets function", () => {
  const names = (...args: Parameters<typeof resolveProfile>) =>
    resolveProfile(...args).map(({ name }) => name);
  expect(names("agent-skill")).not.toContain("secrets");
  expect(names("agent-skill")).not.toContain("evals");
  expect(names("agent-skill", ["evals"])).toContain("evals");
  expect(names("agent-skill", [], [], "all")).toContain("evals");
});
