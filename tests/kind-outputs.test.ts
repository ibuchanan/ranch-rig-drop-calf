import { expect, test } from "bun:test";
import { OSS_ASSETS } from "../src/oss.ts";
import { buildProject } from "../src/profiles.ts";
import { applySync, planSync } from "../src/sync.ts";
import {
  biomeTemplates,
  changelogTemplates,
  docsTemplates,
  gitHooksTemplates,
  secretsTemplates,
  typescriptTemplates,
} from "./templates-source.ts";
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
    expect(Boolean(scripts["lint:check"])).toBe(true);
    expect(Boolean(scripts["forge:deploy"])).toBe(kind === "forge-app");
    expect(Boolean(project.packageJson.exports)).toBe(kind === "library");
    // SecretSpec lives in `templates/secretspec`, not the blueprint, so no kind
    // carries it until sync seeds it for forge-app.
    expect(project.files.has("secretspec.toml")).toBe(false);

    const files = new Map([...project.files, ...docsTemplates()]);
    files.set("package.json", `${JSON.stringify(project.packageJson)}\n`);
    files.set("README.md", "# My custom README\n");
    // Every kind seeds its configs from `templates/typescript`, `templates/biome`
    // and `templates/git-hooks`, the releasing kinds their release policy from
    // `templates/changelog`, and forge-app its SecretSpec tree from
    // `templates/secretspec`; the snapshot above is blueprint-only, so exercise
    // those paths through sync.
    const seeded = new Map([
      ...typescriptTemplates(),
      ...biomeTemplates(),
      ...gitHooksTemplates(),
      ...changelogTemplates(),
      ...secretsTemplates(),
    ]);
    const first = applySync(
      planSync(files, kind, "tester", undefined, [], [], undefined, seeded),
    ).files;
    expect(first.get("README.md")).toBe("# My custom README\n");
    for (const [path, template] of typescriptTemplates())
      expect(first.get(path)).toBe(template);
    // `.editorconfig` lives in `templates/biome` for sync seeding, but
    // generation still builds it in `project.ts`; assert only the config
    // biome actually generates until that ownership moves.
    for (const [path, template] of biomeTemplates())
      if (path !== ".editorconfig") expect(first.get(path)).toBe(template);
    for (const [path, template] of gitHooksTemplates())
      expect(first.get(path)).toBe(template);
    expect(first.has("cliff.toml")).toBe(kind !== "agent-skill");
    for (const [path, template] of secretsTemplates())
      expect(first.has(path)).toBe(
        kind === "forge-app" && template !== undefined,
      );
    expect(
      planSync(first, kind, "tester", undefined, [], [], undefined, seeded)
        .operations,
    ).toEqual([]);
  },
);
