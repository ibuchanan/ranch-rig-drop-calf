import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { FALLOW_SCRIPT } from "../../src/capabilities/fallow.ts";
import { resolveProfile } from "../../src/composition/profiles.ts";
import { noOpReasons } from "../../src/core/capability.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

for (const kind of ["library", "tool"]) {
  test(`${kind} seeds Fallow, preserves owner config, and maintains script and pin`, async () => {
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
      const config = await initialized.file(".fallowrc.jsonc").contents();
      expect(config).toContain('"git-cliff"');
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts["lint:check:fallow"]).toBe(FALLOW_SCRIPT);
      expect(pkg.scripts["lint:fallow"]).toBeUndefined();
      expect(pkg.devDependencies.fallow).toBe(TOOL_VERSIONS.fallow);
      const edited = initialized
        .withNewFile(".fallowrc.jsonc", '{"rules":{"unused-files":"off"}}\n')
        .withNewFile(
          "package.json",
          JSON.stringify({
            ...pkg,
            scripts: { ...pkg.scripts, "lint:check:fallow": "owner" },
            devDependencies: { ...pkg.devDependencies, fallow: "0.0.1" },
          }),
        );
      const updated = await module.update(edited, kind);
      expect(await updated.file(".fallowrc.jsonc").contents()).toBe(
        '{"rules":{"unused-files":"off"}}\n',
      );
      const maintained = JSON.parse(
        await updated.file("package.json").contents(),
      );
      expect(maintained.scripts["lint:check:fallow"]).toBe(FALLOW_SCRIPT);
      expect(maintained.devDependencies.fallow).toBe(TOOL_VERSIONS.fallow);
      expect(await module.update(updated, kind)).toBe(updated);
      const removed = updated.withoutFile(".fallowrc.jsonc");
      expect(await module.update(removed, kind)).toBe(removed);
      expect(JSON.parse(await module.validate(removed, kind))).toContainEqual({
        capability: "fallow",
        status: "skipped",
        reason: noOpReasons(resolveProfile(kind)).find(
          (item) => item.capability === "fallow" && item.verb === "validate",
        )?.reason,
      });
      const optedOut = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
        "",
        [],
        ["fallow"],
      );
      expect(await optedOut.exists(".fallowrc.jsonc")).toBe(false);
      const omitted = JSON.parse(
        await optedOut.file("package.json").contents(),
      );
      expect(omitted.scripts["lint:check:fallow"]).toBeUndefined();
      expect(omitted.devDependencies.fallow).toBeUndefined();
      expect(
        resolveProfile(kind, [], ["fallow"]).map((item) => item.name),
      ).not.toContain("fallow");
      expect(
        resolveProfile(kind, [], [], "all").map((item) => item.name),
      ).toContain("fallow");
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  });
}

test("Fallow is excluded from Forge and agent-skill, including all preset", () => {
  for (const kind of ["forge-app", "agent-skill"])
    expect(
      resolveProfile(kind, [], [], "all").map((item) => item.name),
    ).not.toContain("fallow");
});
