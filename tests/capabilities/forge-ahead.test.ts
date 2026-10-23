import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { forgeAhead } from "../../src/capabilities/forge-ahead.ts";
import {
  noOpReasons,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { createBlueprint } from "../../src/core/project.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { DropCalf } from "../../src/index.ts";
import { runInit } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

const apiTypes = "@forge-ahead/atlassian-api-types";
const authoritative = {
  "@forge-ahead/errors": TOOL_VERSIONS.forgeAheadErrors,
  "@forge-ahead/logging": TOOL_VERSIONS.forgeAheadLogging,
};
test("Forge Ahead init seeds all three libraries without replacing unrelated dependencies", () => {
  const project = createBlueprint("sample", "", "tester");
  const dependencies = { "@forge/api": "^7", "@forge-ahead/errors": "owner" };
  project.packageJson.dependencies = { ...dependencies };
  const capability = forgeAhead();
  expect(typeof capability.init).not.toBe("function");
  runInit(capability, project);
  expect(project.packageJson.dependencies).toEqual({
    ...dependencies,
    ...authoritative,
    [apiTypes]: TOOL_VERSIONS.forgeAheadApiTypes,
  });
  expect(project.packageJson.devDependencies).toEqual({});
  expect(project.files.size).toBe(0);
  expect(project.templates.map((template) => template.path)).toEqual([]);
});

test("Forge Ahead validation is an explicit no-op without reading or installing", async () => {
  const capability = forgeAhead();
  expect(typeof capability.validate).not.toBe("function");
  const reason = noOpReasons([capability]).find(
    (entry) => entry.verb === "validate",
  );
  if (!reason) throw new Error("Forge Ahead validation reason is missing");
  expect(reason).toMatchObject({
    capability: "forge-ahead",
    verb: "validate",
    reason: expect.stringContaining("no repository-local configuration"),
  });
  const input = new Proxy({} as Directory, {
    get() {
      throw new Error("unexpected repository access");
    },
  });
  expect(await validateCapabilities(input, [capability])).toEqual([
    { capability: "forge-ahead", status: "skipped", reason: reason.reason },
  ]);
});

test.each([false, true])(
  "Forge app init includes all three dependencies alongside scaffold dependencies (scaffold: %j)",
  async (scaffold) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const dependencies = scaffold ? { "@forge/api": "^7", other: "^2" } : {};
      const input = mockDirectory(
        new Map(
          scaffold ? [["package.json", JSON.stringify({ dependencies })]] : [],
        ),
      );
      const module = new DropCalf();
      const initialized = await module.init(
        input,
        "forge-app",
        "tester",
        "sample",
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.dependencies).toEqual({
        ...dependencies,
        [apiTypes]: TOOL_VERSIONS.forgeAheadApiTypes,
        ...authoritative,
      });
      expect(await module.update(initialized, "forge-app")).toBe(initialized);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);
