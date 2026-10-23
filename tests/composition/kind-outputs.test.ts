import { expect, spyOn, test } from "bun:test";
import { dag } from "@dagger.io/dagger";
import { resolveProfile } from "../../src/composition/profiles.ts";
import { DropCalf } from "../../src/index.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

test.each([undefined, "all"])(
  "library omits Size Limit and preserves owner size checks (%s)",
  async (preset) => {
    const source = mockModuleSource();
    const stub = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const selected = resolveProfile("library", [], [], preset).map(
        (capability) => capability.name,
      );
      expect(selected).not.toContain("size-limit");
      expect(selected).toContain("todo");
      expect(selected).toContain("docs");
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        "library",
        "tester",
        "sample",
        "",
        [],
        [],
        preset,
      );
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      expect(pkg.scripts["size:check"]).toBeUndefined();
      const tools = ["size-limit", "@size-limit/file"];
      for (const name of tools)
        expect(pkg.devDependencies[name]).toBeUndefined();
      expect(pkg["size-limit"]).toBeUndefined();

      pkg.scripts["size:check"] = "owner size check";
      for (const name of tools) pkg.devDependencies[name] = "0.0.1";
      pkg["size-limit"] = [{ path: "owner.js", limit: "25 kB" }];
      const edited = initialized.withNewFile(
        "package.json",
        JSON.stringify(pkg),
      );
      const updated = await module.update(edited, "library", [], [], preset);
      const maintained = JSON.parse(
        await updated.file("package.json").contents(),
      );
      expect(maintained.scripts["size:check"]).toBe("owner size check");
      for (const name of tools)
        expect(maintained.devDependencies[name]).toBe("0.0.1");
      expect(maintained["size-limit"]).toEqual(pkg["size-limit"]);
      expect(await module.update(updated, "library", [], [], preset)).toBe(
        updated,
      );
    } finally {
      stub.mockRestore();
      source.mockRestore();
    }
  },
);

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
      expect(Boolean(scripts["size:check"])).toBe(kind === "forge-app");
      expect(Boolean(scripts.todo)).toBe(true);
      expect(Boolean(scripts["lint:docs"])).toBe(true);
      expect(Boolean(scripts.changelog)).toBe(true);
      expect(scripts.release).toBe("bash scripts/release.sh");
      expect(Boolean(scripts["release:check"])).toBe(true);
      expect(scripts["release:prepare"]).toBeUndefined();
      expect(scripts["release:publish"]).toBeUndefined();
      expect(await result.exists("scripts/release.sh")).toBe(true);
      expect(await result.exists("scripts/release.ts")).toBe(false);
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
