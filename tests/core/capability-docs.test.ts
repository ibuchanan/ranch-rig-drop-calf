import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INVENTORY_END,
  INVENTORY_START,
  REFERENCE_END,
  REFERENCE_FILES,
  REFERENCE_START,
  renderCapabilityInventory,
  renderCapabilityReference,
  replaceGeneratedBlock,
} from "../../scripts/capability-reference.ts";
import { bunTesting } from "../../src/capabilities/bun-testing.ts";
import { vitestTesting } from "../../src/capabilities/vitest.ts";
import { buildProject, PROFILES } from "../../src/composition/profiles.ts";
import { type Capability, noOpReasons } from "../../src/core/capability.ts";

const root = new URL("../../", import.meta.url);

for (const path of REFERENCE_FILES) {
  test(`${path} capability reference matches current profile, tool, verb, and reason data`, () => {
    const contents = readFileSync(new URL(path, root), "utf8");
    expect(
      contents,
      "Regenerate with bun run scripts/refresh-capability-docs.ts",
    ).toBe(
      replaceGeneratedBlock(
        contents,
        REFERENCE_START,
        REFERENCE_END,
        renderCapabilityReference(),
      ),
    );
  });
}

test("kind inventory includes every capability in execution order", () => {
  const contents = readFileSync(
    new URL("specs/01-project-kinds.md", root),
    "utf8",
  );
  expect(
    contents,
    "Regenerate with bun run scripts/refresh-capability-docs.ts",
  ).toBe(
    replaceGeneratedBlock(
      contents,
      INVENTORY_START,
      INVENTORY_END,
      renderCapabilityInventory(),
    ),
  );
});

test("reference includes exact no-op reasons and distinguishes Bun/Vitest and selection", () => {
  const reference = renderCapabilityReference();
  for (const capabilities of Object.values(PROFILES))
    for (const { reason } of noOpReasons(capabilities))
      expect(reference).toContain(`**No-op:** ${reason}`);
  expect(reference).toContain("[Bun test]");
  expect(reference).toContain("[Vitest]");
  expect(reference).toContain(
    "Opt-in; `--with-functions evals`; `--without-functions evals`; `--preset all`",
  );
  expect(reference).toContain("Default; `--without-functions aidev`");
  expect(reference).toContain("dist/**/*.js");
  const rows = renderCapabilityReference({
    first: [bunTesting()],
    second: [bunTesting()],
    forge: [vitestTesting()],
  });
  expect(rows).toContain("| `first`, `second` | `test` |");
  expect(rows).toContain("| `forge` | `test` |");
});

test("changes to capability descriptions, reasons, or membership produce documentation drift", () => {
  const original = bunTesting();
  const baseline = renderCapabilityReference({ sample: [original] });
  const reason = { ...original, update: { reason: "Changed no-op reason" } };
  const description = {
    ...original,
    documentation: {
      ...original.documentation,
      tools: original.documentation.tools.map((tool) => ({
        ...tool,
        purpose: "Changed tool purpose",
      })),
    },
  };
  for (const changed of [reason, description])
    expect(renderCapabilityReference({ sample: [changed] })).not.toBe(baseline);
  expect(renderCapabilityReference({ sample: [] })).not.toBe(baseline);
});

test("reference rejects incomplete metadata or separate no-op descriptions", () => {
  const original = bunTesting();
  const broken: Capability[] = [
    { ...original, documentation: { tools: [] } },
    { ...original, documentation: { ...original.documentation, update: "" } },
    {
      ...original,
      documentation: { ...original.documentation, init: "Duplicated reason" },
    },
    {
      ...original,
      documentation: {
        ...original.documentation,
        tools: [{ name: "", url: "bad", purpose: "" }],
      },
    },
  ];
  for (const capability of broken)
    expect(() => renderCapabilityReference({ sample: [capability] })).toThrow(
      "sample/test",
    );
});

test("table text cannot create extra columns or lines", () => {
  const original = bunTesting();
  const reference = renderCapabilityReference({
    sample: [{ ...original, init: { reason: "a | b\nc" } }],
  });
  expect(reference).toContain("**No-op:** a &#124; b c");
});

test("block refresh preserves surrounding prose and refuses unsafe markers", () => {
  const start = "<!-- start -->";
  const end = "<!-- end -->";
  const block = `${start}\nnew\n${end}`;
  const input = `before\n${start}\nold\n${end}\nafter`;
  const output = replaceGeneratedBlock(input, start, end, block);
  expect(output).toBe(`before\n${block}\nafter`);
  expect(replaceGeneratedBlock(output, start, end, block)).toBe(output);
  for (const invalid of [
    "missing",
    `${end}${start}`,
    `${start}${end}${start}`,
    `${start}${end}${end}`,
  ])
    expect(() => replaceGeneratedBlock(invalid, start, end, block)).toThrow(
      "exactly one ordered",
    );
});

test("every initialized kind supplies the documented check workflow", () => {
  for (const kind of Object.keys(PROFILES))
    expect(
      buildProject(kind, "sample", "tester").packageJson.scripts.check,
    ).toBe("lefthook run pre-push --force");
});
