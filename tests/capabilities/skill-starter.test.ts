import { expect, test } from "bun:test";
import {
  SKILL_STARTER_SCRIPTS,
  SKILL_STARTER_TEMPLATE,
  skillStarter,
} from "../../src/capabilities/skill-starter.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { noOpReasons } from "../../src/core/capability.ts";
import { skillStarterTemplates } from "../support/templates-source.ts";

test("skill starter seeds its tree and leaves update and validate as explained no-ops", () => {
  expect(noOpReasons([skillStarter()]).map(({ verb }) => verb)).toEqual([
    "update",
    "validate",
  ]);
});

test("agent-skill seeds one script with its test, a first skill, and its spec", () => {
  const { packageJson, templates } = buildProject(
    "agent-skill",
    "sample",
    "tester",
  );
  expect(templates.map(({ path }) => path)).toContain(SKILL_STARTER_TEMPLATE);
  expect(packageJson.scripts).toMatchObject(SKILL_STARTER_SCRIPTS);
  expect([...skillStarterTemplates().keys()]).toEqual([
    "skills/example-skill/SKILL.md",
    "specs/example-skill.md",
    "src/scripts/list-skills.ts",
    "tests/scripts/list-skills.test.ts",
  ]);
});

test("the starter skill's name matches its directory and spec", () => {
  const skill = skillStarterTemplates().get("skills/example-skill/SKILL.md");
  expect(skill).toStartWith("---\nname: example-skill\n");
  expect(skillStarterTemplates().has("specs/example-skill.md")).toBe(true);
});

test("only agent-skill selects the starter", () => {
  for (const kind of ["library", "forge-app", "tool"])
    expect(
      buildProject(kind, "sample", "tester").templates.some(
        ({ path }) => path === SKILL_STARTER_TEMPLATE,
      ),
    ).toBe(false);
});
