import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s README describes only available scripts and required starter inputs",
  (kind) => {
    const project = buildProject(kind, "sample", "A sample project", "none");
    const readme = project.files.get("README.md") ?? "";
    const scripts = project.packageJson.scripts;
    for (const [, command] of readme.matchAll(/npm (?:run )?([\w:-]+)/g)) {
      if (command !== "install") expect(scripts[command ?? ""]).toBeDefined();
    }
    expect(readme).toContain("src/index.ts");
    expect(readme).toContain("npm install");
    expect(readme).toContain("npm run build");
    if (kind === "forge-app") expect(readme).toContain("Forge manifest");
    else expect(readme).not.toContain("Forge manifest");
    if (scripts.test) {
      expect(readme).toContain("bun test");
      expect(readme).toContain("npm test");
    } else {
      expect(readme).not.toContain("## Test");
      expect(readme).not.toContain("npm test");
    }
  },
);

test("Forge README mentions evaluations only when selected", () => {
  const ordinary = buildProject("forge-app", "sample", "", "none");
  const selected = buildProject("forge-app", "sample", "", "none", "", [
    "evals",
  ]);
  expect(ordinary.files.get("README.md")).not.toContain("npm run eval");
  expect(selected.files.get("README.md")).toContain("npm run eval");
  expect(selected.files.get("README.md")).toContain("npm run view");
});

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s generated output has the selected functions and converges without losing user prose",
  (kind) => {
    const project = buildProject(kind, "sample", "A sample project", "none");
    const scripts = project.packageJson.scripts;
    expect(
      JSON.stringify(
        {
          packageJson: project.packageJson,
          files: Object.fromEntries(project.files),
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

    const readme = project.files.get("README.md") ?? "";
    const customized = readme
      .replace(
        "<!-- drop-calf:usage start -->",
        "My notes.\n<!-- drop-calf:usage start -->",
      )
      .replace(
        /<!-- drop-calf:usage start -->[\s\S]*?<!-- drop-calf:usage end -->/,
        "<!-- drop-calf:usage start -->\nOutdated guidance\n<!-- drop-calf:usage end -->",
      )
      .concat("\nMy closing notes.\n");
    const files = new Map(project.files);
    files.set("package.json", `${JSON.stringify(project.packageJson)}\n`);
    files.set("README.md", customized);
    const first = applySync(planSync(files, kind)).files;
    expect(first.get("README.md")).toContain(
      "My notes.\n<!-- drop-calf:usage start -->",
    );
    expect(first.get("README.md")).toContain("My closing notes.\n");
    expect(first.get("README.md")).not.toContain("Outdated guidance");
    expect(first.get("README.md")).toContain("src/index.ts");
    expect(planSync(first, kind).operations).toEqual([]);
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
      await new DropCalf().files(kind, "sample", "A sample project", "none");
      const project = buildProject(kind, "sample", "A sample project", "none");
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
