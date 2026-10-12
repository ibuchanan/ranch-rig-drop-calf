import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { docsTemplates } from "./templates-source.ts";

test("docs template paths do not overlap other generated files", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const generated = new Set([
      "package.json",
      ...buildProject(
        kind,
        "sample",
        "tester",
        "",
        "",
        [],
        [],
        "all",
      ).files.keys(),
    ]);
    for (const path of docsTemplates().keys())
      expect(generated.has(path)).toBe(false);
  }
});

test("the docs tree carries a config for each tool lint:docs runs", () => {
  // Matched by shape, not by name or content: the configs are template
  // territory. What is load-bearing is that both tools find one here.
  const paths = [...docsTemplates().keys()];
  expect(paths.some((path) => /^\.cspell\.jsonc?$/.test(path))).toBe(true);
  expect(paths.some((path) => /^\.markdownlint-cli2\.jsonc?$/.test(path))).toBe(
    true,
  );
});

test("every kind lints its seeded docs with cspell and markdownlint-cli2", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts["lint:docs"]).toBe(
      'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"',
    );
    expect(packageJson.devDependencies.cspell).toBe(TOOL_VERSIONS.cspell);
    expect(packageJson.devDependencies["markdownlint-cli2"]).toBe(
      TOOL_VERSIONS.markdownlintCli2,
    );
  }
});
