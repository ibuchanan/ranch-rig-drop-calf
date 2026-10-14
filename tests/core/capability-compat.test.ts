// The legacy migration oracle is retired; keep the current-contract equivalence
// checks separate from capability orchestration tests.
import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { renderToDirectory } from "../../src/core/project.ts";
import { seedTemplates } from "../../src/core/templates.ts";
import { DropCalf } from "../../src/index.ts";
import { contents, kinds, selections } from "../support/capability-fixtures.ts";
import {
  mockModuleSource,
  mockDirectory as tree,
} from "../support/module-source.ts";

test.each(kinds)(
  "%s init equals seed-then-update and maintenance is idempotent",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() => tree());
    try {
      for (const selection of selections(kind)) {
        const project = buildProject(
          kind,
          "sample",
          "tester",
          "A sample project",
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        const module = new DropCalf();
        const seeded = await seedTemplates(
          renderToDirectory(project),
          dag.currentModule().source(),
          project.templates,
        );
        const generated = await module.update(
          seeded,
          kind,
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        const initialized = await module.init(
          tree(),
          kind,
          "tester",
          "sample",
          "A sample project",
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        );
        expect(contents(initialized)).toEqual(contents(generated));
        expect(
          contents(
            await module.update(
              initialized,
              kind,
              selection.withFunctions,
              selection.withoutFunctions,
              selection.preset,
            ),
          ),
        ).toEqual(contents(initialized));
        for (const item of resolveProfile(
          kind,
          selection.withFunctions,
          selection.withoutFunctions,
          selection.preset,
        )) {
          expect(item).not.toHaveProperty("addTo");
          expect(item).not.toHaveProperty("templates");
        }
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
