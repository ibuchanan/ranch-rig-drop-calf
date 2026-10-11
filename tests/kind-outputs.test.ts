import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s generated output has the selected functions",
  async (kind) => {
    const source = mockModuleSource();
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      // Keep the historical blueprint-only snapshot shape, but read actual init bytes.
      const project = buildProject(
        kind,
        "sample",
        "tester",
        "A sample project",
      );
      const result = await new DropCalf().init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
        "A sample project",
      );
      const packageJson = JSON.parse(
        await result.file("package.json").contents(),
      );
      const scripts = packageJson.scripts;
      expect(
        JSON.stringify(
          {
            packageJson,
            files: Object.fromEntries(
              await Promise.all(
                [...project.files.keys()]
                  .filter(
                    (path) =>
                      !OSS_ASSETS.includes(path as (typeof OSS_ASSETS)[number]),
                  )
                  .map(async (path) => [
                    path,
                    await result.file(path).contents(),
                  ]),
              ),
            ),
          },
          null,
          2,
        ),
      ).toMatchSnapshot(kind);
      expect(Boolean(scripts.test)).toBe(kind !== "agent-skill");
      expect(Boolean(scripts.size)).toBe(
        kind === "library" || kind === "forge-app",
      );
      expect(Boolean(scripts.changelog)).toBe(kind !== "agent-skill");
      expect(Boolean(scripts["lint:forge"])).toBe(kind === "forge-app");
      expect(Boolean(scripts["lint:prelint"])).toBe(kind === "forge-app");
      expect(Boolean(scripts["lint:check"])).toBe(true);
      expect(Boolean(scripts["forge:deploy"])).toBe(kind === "forge-app");
      expect(Boolean(packageJson.exports)).toBe(kind === "library");
      expect(await result.exists("secretspec.toml")).toBe(kind === "forge-app");
    } finally {
      stub.mockRestore();
      source.mockRestore();
    }
  },
);
