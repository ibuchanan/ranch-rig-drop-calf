import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { copyTemplate, templateTree } from "./templates.ts";
import { bunTools, REPOSITORY, runTool } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const DOCS_TEMPLATE = "templates/docs";
export const DOCS_COMMAND =
  'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"';
export const DOCS_CONFIGS = [
  ".markdownlint-cli2.jsonc",
  ".cspell.jsonc",
] as const;

export function copyDocs(destination: Directory, source: Directory): Directory {
  return copyTemplate(destination, source);
}

/** Load the two root configs and their references, never lint documentation content. */
export async function validateDocs(
  directory: Directory,
  cspellVersion: string = TOOL_VERSIONS.cspell,
  markdownlintVersion: string = TOOL_VERSIONS.markdownlintCli2,
): Promise<Validation> {
  const missing: string[] = [];
  for (const path of DOCS_CONFIGS)
    if (!(await directory.exists(path))) missing.push(path);
  if (missing.length === DOCS_CONFIGS.length)
    return {
      status: "skipped",
      reason: `${missing.join(" and ")} are missing`,
    };
  if (missing.length)
    return { status: "failed", reason: `${missing.join(" and ")} is missing` };
  const container = bunTools(
    `cspell@${cspellVersion}`,
    `markdownlint-cli2@${markdownlintVersion}`,
  )
    .withMountedDirectory(REPOSITORY, directory, { readOnly: true })
    .withWorkdir(REPOSITORY)
    // Disable owner globs and exclude everything, even when the config enables fixes.
    .withExec([
      "bun",
      "run",
      "--no-install",
      "/tools/node_modules/markdownlint-cli2/markdownlint-cli2-bin.mjs",
      "--config",
      DOCS_CONFIGS[0],
      "--no-globs",
      "**/*.md",
      "#**",
    ])
    .withExec([
      "bun",
      "run",
      "--no-install",
      "/tools/node_modules/cspell/bin.mjs",
      "lint",
      "--config",
      DOCS_CONFIGS[1],
      "--no-config-search",
      "--no-must-find-files",
      "--no-progress",
      "--exclude",
      "**",
      "**/*.md",
    ]);
  await runTool(container, "docs: validation");
  return { status: "validated" };
}

export function docsLinting(
  cspellVersion: string = TOOL_VERSIONS.cspell,
  markdownlintVersion: string = TOOL_VERSIONS.markdownlintCli2,
): Capability {
  return {
    name: "docs",
    documentation: {
      tools: [
        {
          name: "markdownlint-cli2",
          url: "https://github.com/igorshubovych/markdownlint-cli2",
          purpose: "Lints markdown files against consistent style rules",
        },
        {
          name: "CSpell",
          url: "https://cspell.org/",
          purpose: "Spell-checks documentation and code comments",
        },
      ],
      init: "Seed Markdown/spelling tools and lint:docs, configs, DEVELOPMENT.md, and Diátaxis/spec starter documents.",
      validate:
        "Load Markdown/spelling configs and references without scanning documentation quality.",
    },
    packageJson: {
      seed: {
        devDependencies: {
          cspell: cspellVersion,
          "markdownlint-cli2": markdownlintVersion,
        },
      },
      policy: {
        scripts: { "lint:docs": DOCS_COMMAND },
      },
    },
    init(project) {
      project.templates.push(templateTree(DOCS_TEMPLATE));
    },
    update: noOp(
      "Docs configuration and documents are owner-managed after init, including deletions; its package.json contribution enforces lint:docs and keeps the seeded tool dependencies fresh.",
    ),
    validate: (directory) =>
      validateDocs(directory, cspellVersion, markdownlintVersion),
  };
}
