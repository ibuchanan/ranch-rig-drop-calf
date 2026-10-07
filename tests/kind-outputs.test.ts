import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { OSS_ASSETS } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s generated output has the selected functions and converges without losing user prose",
  (kind) => {
    const project = buildProject(kind, "sample", "tester", "A sample project");
    const scripts = project.packageJson.scripts;
    expect(
      JSON.stringify(
        {
          packageJson: project.packageJson,
          files: Object.fromEntries(
            [...project.files].filter(
              ([path]) =>
                !OSS_ASSETS.includes(path as (typeof OSS_ASSETS)[number]),
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
    expect(Boolean(scripts["forge:deploy"])).toBe(kind === "forge-app");
    expect(Boolean(project.packageJson.exports)).toBe(kind === "library");
    expect(project.files.has("secretspec.toml")).toBe(kind === "forge-app");
    expect(project.files.get("lefthook.yml")?.includes("esa-test:")).toBe(
      kind !== "agent-skill",
    );

    const files = new Map(project.files);
    files.set("package.json", `${JSON.stringify(project.packageJson)}\n`);
    files.set("README.md", "# My custom README\n");
    const first = applySync(planSync(files, kind, "tester")).files;
    expect(first.get("README.md")).toBe("# My custom README\n");
    expect(planSync(first, kind, "tester").operations).toEqual([]);
  },
);

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s Dagger files renders the selected package and README",
  async (kind) => {
    const writes = new Map<string, string>();
    const directory = {
      withNewFile(path: string, contents: string) {
        writes.set(path, contents);
        return directory;
      },
    } as unknown as Directory;
    const stub = spyOn(dag, "directory").mockReturnValue(directory);
    try {
      await new DropCalf().files(kind, "tester", "sample", "A sample project");
      const project = buildProject(
        kind,
        "sample",
        "tester",
        "A sample project",
      );
      expect(JSON.parse(writes.get("package.json") ?? "null")).toEqual(
        project.packageJson,
      );
      expect(writes.get("README.md")).toBe(project.files.get("README.md"));
      expect([...writes.keys()].sort()).toEqual(
        ["package.json", ...project.files.keys()].sort(),
      );
    } finally {
      stub.mockRestore();
    }
  },
);
