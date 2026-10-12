/**
 * Expand-phase equivalence oracle.
 *
 * Asserts that the legacy `addTo` + `templates` assembly still produces the
 * same initialized output as the new `init` verb, for every profile and
 * optional-function selection. This is the safety net that lets capabilities
 * migrate to the triple-verb shape one at a time (ADR 0001).
 *
 * Delete this file together with `addTo`, `templates`, and `expandCapability`
 * when the migration reaches contract. The per-capability policy tests and
 * `capability-verbs.test.ts` remain.
 */
import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { seedAgentGuidance } from "../src/aidev.ts";
import type { Capability } from "../src/capability.ts";
import { evals } from "../src/evals.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject, PROFILES, resolveProfile } from "../src/profiles.ts";
import { createBlueprint, renderToDirectory } from "../src/project.ts";
import { seedTemplates } from "../src/templates.ts";
import { contents, kinds, selections } from "./capability-fixtures.ts";
import { mockDirectory as tree, mockModuleSource } from "./module-source.ts";

// The pre-expansion assembly, kept as an independent compatibility oracle.
// A capability whose `init` is inactive contributes nothing to initialization,
// so its retained `addTo` contribution is legacy-only and is skipped here.
function legacyProject(
  kind: string,
  withFunctions: string[],
  withoutFunctions: string[],
  preset?: string,
) {
  const project = createBlueprint("sample", "A sample project", "tester");
  const add = (capability: Capability) => {
    if (typeof capability.init === "function") capability.addTo(project);
    project.templates.push(...(capability.templates ?? []));
  };
  for (const capability of PROFILES[kind] ?? []) add(capability);
  if (!withoutFunctions.includes("aidev")) seedAgentGuidance(project, kind);
  if (
    kind === "forge-app" &&
    (preset === "all" || withFunctions.includes("evals")) &&
    !withoutFunctions.includes("evals")
  )
    add(evals());
  return project;
}

test.each(kinds)(
  "%s required verbs preserve initialized legacy output and update leaves init unchanged",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() => tree());
    try {
      for (const { withFunctions, withoutFunctions, preset } of selections(
        kind,
      )) {
        const legacy = legacyProject(
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          "Tester",
          withFunctions,
          withoutFunctions,
          preset,
        );
        expect(project.packageJson).toEqual(legacy.packageJson);
        expect([...project.files]).toEqual([...legacy.files]);
        expect(project.templates).toEqual(legacy.templates);
        const capabilities = resolveProfile(
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        expect(new Set(capabilities.map((item) => item.name)).size).toBe(
          capabilities.length,
        );
        // Every capability exposes all three verbs; per-capability policy tests
        // own whether a given verb is active (ADR 0001).
        for (const capability of capabilities) {
          expect(capability.init).toBeDefined();
          expect(capability.update).toBeDefined();
          expect(capability.validate).toBeDefined();
        }
        const module = new DropCalf();
        const seeded = await seedTemplates(
          renderToDirectory(legacy),
          dag.currentModule().source(),
          legacy.templates,
          "sample",
          {
            name: "sample",
            owner: "tester",
            type: kind,
            description: "A sample project",
          },
        );
        const generated = await module.update(
          await module.copyGitignore(seeded),
          kind,
          withFunctions,
          withoutFunctions,
          preset,
        );
        const initialized = await module.init(
          tree(),
          kind,
          "tester",
          "sample",
          "A sample project",
          "Tester",
          withFunctions,
          withoutFunctions,
          preset,
        );
        expect(contents(initialized)).toEqual(contents(generated));
        expect(
          await module.update(
            initialized,
            kind,
            withFunctions,
            withoutFunctions,
            preset,
          ),
        ).toBe(initialized);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
