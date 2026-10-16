import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { parse } from "yaml";
import { packageCheck } from "../../src/capabilities/package-check.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import {
  noOpReasons,
  validateCapabilities,
} from "../../src/core/capability.ts";
import { DropCalf } from "../../src/index.ts";
import { runUpdate } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

test("generated library has a package checker and check dispatches it through the seeded pre-push hook", async () => {
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const output = await new DropCalf().init(
      mockDirectory(),
      "library",
      "tester",
      "sample",
    );
    expect(await output.exists("scripts/pack-check.sh")).toBe(true);
    const pkg = JSON.parse(await output.file("package.json").contents());
    expect(pkg.scripts.check).toBe("lefthook run pre-push --force");
    expect(pkg.scripts["pack:check"]).toBe(
      "npm run build && sh scripts/pack-check.sh",
    );
    const hooks = parse(await output.file("lefthook.yml").contents());
    expect(hooks["pre-push"].commands.pack.run).toBe(
      "npm run pack:check --if-present",
    );
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("update restores the owned checker script while preserving owner configuration and publishing metadata", async () => {
  const source = mockModuleSource();
  const empty = spyOn(dag, "directory").mockImplementation(() =>
    mockDirectory(),
  );
  try {
    const module = new DropCalf();
    const initialized = await module.init(
      mockDirectory(),
      "library",
      "tester",
      "sample",
    );
    const pkg = JSON.parse(await initialized.file("package.json").contents());
    const owner = {
      main: "owner/index.cjs",
      types: "owner/index.d.cts",
      exports: { ".": "./owner/index.cjs", "./extra": "./owner/extra.js" },
      files: ["owner"],
      sideEffects: ["./owner/register.js"],
      peerDependencies: { react: "^19" },
      engines: { node: ">=22" },
    };
    Object.assign(pkg, owner);
    pkg.scripts["pack:check"] = "old command";
    pkg.devDependencies.publint = "0.0.1";
    delete pkg.devDependencies["@arethetypeswrong/cli"];
    const input = initialized
      .withNewFile("package.json", JSON.stringify(pkg))
      .withNewFile("scripts/pack-check.sh", "old checker")
      .withNewFile(".attw.json", '{"profile":"node16"}\n')
      .withNewFile("lefthook.yml", "# owner hooks\n");
    const output = await module.update(input, "library");
    expect(await output.file("scripts/pack-check.sh").contents()).toBe(
      await initialized.file("scripts/pack-check.sh").contents(),
    );
    const updated = JSON.parse(await output.file("package.json").contents());
    expect(updated).toMatchObject(owner);
    expect(updated.scripts["pack:check"]).toBe(
      "npm run build && sh scripts/pack-check.sh",
    );
    expect(updated.devDependencies.publint).not.toBe("0.0.1");
    expect(updated.devDependencies["@arethetypeswrong/cli"]).toBeUndefined();
    expect(await output.file(".attw.json").contents()).toBe(
      '{"profile":"node16"}\n',
    );
    expect(await output.file("lefthook.yml").contents()).toBe(
      "# owner hooks\n",
    );
    expect(await module.update(output, "library")).toBe(output);
  } finally {
    empty.mockRestore();
    source.mockRestore();
  }
});

test("standalone package-check validation skips artifact work without repository or tool access", async () => {
  const capability = packageCheck();
  const input = new Proxy({} as Directory, {
    get() {
      throw new Error("must not inspect artifacts");
    },
  });
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("must not run tools");
  });
  try {
    const result = await validateCapabilities(input, [capability]);
    expect(result[0]?.status).toBe("skipped");
    expect(noOpReasons([capability])).toEqual([
      {
        capability: "package-check",
        verb: "validate",
        reason: expect.stringContaining("fresh build artifacts"),
      },
    ]);
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});

test("update preserves newer checker versions and does not invent configuration or missing packages", async () => {
  const source = mockModuleSource();
  try {
    const capability = packageCheck();
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({
            devDependencies: {
              publint: "99.0.0",
              "@arethetypeswrong/cli": "99.0.0",
            },
          }),
        ],
      ]),
    );
    const output = await runUpdate(capability, input);
    expect(
      JSON.parse(await output.file("package.json").contents()).devDependencies,
    ).toEqual({ publint: "99.0.0", "@arethetypeswrong/cli": "99.0.0" });
    expect(await output.exists(".attw.json")).toBe(false);
    expect(await runUpdate(capability, output)).toBe(output);
    const empty = mockDirectory();
    expect(await runUpdate(capability, empty)).toBe(empty);
  } finally {
    source.mockRestore();
  }
});

test("only libraries select package-check and seed its command and exact checker pins", () => {
  for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
    const selected = resolveProfile(kind).map((capability) => capability.name);
    const { scripts, devDependencies } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    if (kind === "library") {
      expect(selected).toContain("package-check");
      expect(scripts["pack:check"]).toContain("npm run build &&");
      expect(devDependencies.publint).toMatch(/^\d+\.\d+\.\d+$/);
      expect(devDependencies["@arethetypeswrong/cli"]).toMatch(
        /^\d+\.\d+\.\d+$/,
      );
    } else {
      expect(selected).not.toContain("package-check");
      expect(scripts["pack:check"]).toBeUndefined();
      expect(devDependencies.publint).toBeUndefined();
      expect(devDependencies["@arethetypeswrong/cli"]).toBeUndefined();
    }
  }
});
