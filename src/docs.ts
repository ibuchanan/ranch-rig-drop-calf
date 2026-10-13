import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { EVALS_TEMPLATE } from "./evals.ts";
import { templateTree } from "./templates.ts";
import { bunTools, REPOSITORY, runTool } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const DOCS_TEMPLATE = "templates/docs";
export const DOCS_COMMAND =
  'markdownlint-cli2 "**/*.md" && cspell lint "**/*.md"';
export const DOCS_CONFIGS = [
  ".markdownlint-cli2.jsonc",
  ".cspell.jsonc",
] as const;

/** Load the two root configs and their references, never lint documentation content. */
async function validateDocs(directory: Directory): Promise<Validation> {
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
    `cspell@${TOOL_VERSIONS.cspell}`,
    `markdownlint-cli2@${TOOL_VERSIONS.markdownlintCli2}`,
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

type DocsLayout = {
  testDirectory: string;
  testPurpose: string;
  scriptsPurpose?: string;
};

const commonLayout = [
  "- `.atlassian/`: Repository ownership metadata.",
  "- `src/`: TypeScript source code.",
  "- `docs/`: Diataxis guides, reference, explanations, and tutorials.",
  "- `specs/`: Specifications and reference material; excluded from Biome checks.",
  "- `dist/`: Build output; ignored by Git and excluded from Biome checks.",
];

function repositoryLayout(
  { testDirectory, testPurpose, scriptsPurpose }: DocsLayout,
  evaluations: boolean,
): string {
  const lines = [...commonLayout, `- \`${testDirectory}/\`: ${testPurpose}.`];
  if (scriptsPurpose) lines.push(`- \`scripts/\`: ${scriptsPurpose}.`);
  if (evaluations)
    lines.push("- `prompts/`: Prompt templates for evaluations.");
  return `${lines.join("\n")}\n`;
}

export function docsLinting(
  layout: DocsLayout = {
    testDirectory: "tests",
    testPurpose: "Bun tests for source code and workflows",
  },
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
          cspell: TOOL_VERSIONS.cspell,
          "markdownlint-cli2": TOOL_VERSIONS.markdownlintCli2,
        },
      },
      policy: {
        scripts: { "lint:docs": DOCS_COMMAND },
      },
    },
    init(project) {
      project.templates.push(
        templateTree(DOCS_TEMPLATE, async (destination, source) => {
          const seeded = destination.withDirectory(".", source);
          const path = "DEVELOPMENT.md";
          const contents = await source.file(path).contents();
          const evaluations = project.templates.some(
            (template) => template.path === EVALS_TEMPLATE,
          );
          return seeded.withNewFile(
            path,
            `${contents}\n## Repository layout\n\n${repositoryLayout(layout, evaluations)}`,
          );
        }),
      );
    },
    update: noOp(
      "Docs configuration and documents are owner-managed after init, including deletions; its package.json contribution enforces lint:docs and keeps the seeded tool dependencies fresh.",
    ),
    validate: validateDocs,
  };
}
