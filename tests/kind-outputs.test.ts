import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";

// The full per-kind output is snapshotted in repo-init.test.ts; here we assert
// the selected functions directly so a failure names the missing capability.
test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s generated output has the selected functions",
  async (kind) => {
    const source = mockModuleSource();
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
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
      expect(Boolean(scripts.test)).toBe(true);
      expect(scripts.size).toBeUndefined();
      expect(Boolean(scripts["size:check"])).toBe(
        kind === "library" || kind === "forge-app",
      );
      expect(Boolean(scripts.changelog)).toBe(kind !== "agent-skill");
      expect(Boolean(scripts["lint:forge"])).toBe(kind === "forge-app");
      expect(Boolean(scripts["lint:prelint"])).toBe(kind === "forge-app");
      expect(Boolean(scripts["lint:fallow"])).toBe(
        kind === "library" || kind === "tool",
      );
      expect(await result.exists(".fallowrc.jsonc")).toBe(
        kind === "library" || kind === "tool",
      );
      expect(Boolean(scripts["lint:check"])).toBe(true);
      expect(Boolean(scripts["forge:deploy"])).toBe(kind === "forge-app");
      if (kind === "library") expect(packageJson.main).toBe("dist/index.mjs");
      else expect(Object.hasOwn(packageJson, "main")).toBe(false);
      expect(Boolean(packageJson.exports)).toBe(kind === "library");
      expect(await result.exists("secretspec.toml")).toBe(kind === "forge-app");
    } finally {
      stub.mockRestore();
      source.mockRestore();
    }
  },
);
