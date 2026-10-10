import { expect, test } from "bun:test";
import { OSS_ASSETS } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";
import { docsTemplates, typescriptTemplates } from "./templates-source.ts";
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

    const files = new Map([...project.files, ...docsTemplates()]);
    files.set("package.json", `${JSON.stringify(project.packageJson)}\n`);
    files.set("README.md", "# My custom README\n");
    // Every kind seeds its tsconfigs from `templates/typescript`; the snapshot
    // above is blueprint-only, so exercise that path through sync instead.
    const typeScript = typescriptTemplates();
    const first = applySync(
      planSync(files, kind, "tester", undefined, [], [], undefined, typeScript),
    ).files;
    expect(first.get("README.md")).toBe("# My custom README\n");
    for (const [path, template] of typeScript)
      expect(first.get(path)).toBe(template);
    expect(
      planSync(first, kind, "tester", undefined, [], [], undefined, typeScript)
        .operations,
    ).toEqual([]);
  },
);
