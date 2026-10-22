import { expect, test } from "bun:test";
import { parse } from "yaml";
import { CITATION_FILE, citation } from "../../src/capabilities/citation.ts";
import { buildProject } from "../../src/composition/profiles.ts";
import { noOpReasons } from "../../src/core/capability.ts";

test("citation owns CITATION.cff and leaves update and validate as explained no-ops", () => {
  expect(noOpReasons([citation()]).map(({ verb }) => verb)).toEqual([
    "update",
    "validate",
  ]);
});

test("agent-skill seeds a CITATION.cff derived from the package", () => {
  const { files } = buildProject(
    "agent-skill",
    "@scope/skills",
    "tester",
    "A skill collection: with a colon",
  );
  expect(parse(files.get(CITATION_FILE) ?? "")).toEqual({
    "cff-version": "1.2.0",
    message: "If you use this software, please cite it using this metadata.",
    title: "@scope/skills",
    abstract: "A skill collection: with a colon",
    type: "software",
    version: "0.1.0",
    license: "Apache-2.0",
    authors: [{ name: "tester" }],
  });
});

test("an empty description omits the abstract", () => {
  const { files } = buildProject("agent-skill", "skills", "tester");
  expect(parse(files.get(CITATION_FILE) ?? "")).not.toHaveProperty("abstract");
});

test("only agent-skill selects citation", () => {
  for (const kind of ["library", "forge-app", "tool"])
    expect(
      buildProject(kind, "sample", "tester").files.has(CITATION_FILE),
    ).toBe(false);
});
