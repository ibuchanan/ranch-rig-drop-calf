import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { templateTree } from "./templates.ts";
import { bunTools, REPOSITORY, runTool, TOOLS } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const EVALS_TEMPLATE = "templates/promptfoo";
export const EVALS_CONFIG = "promptfooconfig.yaml";
export const EVALS_SCRIPTS = {
  eval: "promptfoo eval",
  view: "promptfoo view",
} as const;

// Use the CLI's handler without its database migrations or command telemetry.
const EVALS_VALIDATOR = `
import { doValidate } from '/tools/node_modules/promptfoo/dist/src/commands/validate.js';
await doValidate({ config: ['/repo/${EVALS_CONFIG}'], envPath: '/dev/null' }, {});
`;

async function validateEvals(directory: Directory): Promise<Validation> {
  if (!(await directory.exists(EVALS_CONFIG)))
    return { status: "skipped", reason: `${EVALS_CONFIG} is missing` };
  const container = bunTools(`promptfoo@${TOOL_VERSIONS.promptfoo}`)
    .withEnvVariable("PROMPTFOO_DISABLE_TELEMETRY", "1")
    .withEnvVariable("PROMPTFOO_DISABLE_UPDATE", "1")
    .withEnvVariable("PROMPTFOO_CONFIG_DIR", "/tmp/promptfoo")
    .withEnvVariable("PROMPTFOO_LOG_DIR", "/tmp/promptfoo/logs")
    .withMountedDirectory(REPOSITORY, directory, { readOnly: true })
    .withNewFile(`${TOOLS}/validate.mjs`, EVALS_VALIDATOR)
    .withWorkdir(REPOSITORY)
    .withExec(["bun", "run", "--no-install", `${TOOLS}/validate.mjs`]);
  await runTool(container, "evals: validation");
  return { status: "validated" };
}

export function evals(): Capability {
  return {
    name: "evals",
    documentation: {
      tools: [
        {
          name: "Promptfoo",
          url: "https://www.promptfoo.dev/docs/",
          purpose:
            "Evaluates prompts against authored test cases and displays results.",
        },
      ],
      init: "Seed Promptfoo, eval/view scripts, and the config/prompts/tests/data/guide tree; no manifest wiring.",
      validate:
        "Use Promptfoo's native config/schema validator to load suite references; no model calls or assertion execution.",
    },
    selection: { with: true, without: true, default: false },
    packageJson: {
      seed: { devDependencies: { promptfoo: TOOL_VERSIONS.promptfoo } },
      policy: {
        scripts: EVALS_SCRIPTS,
      },
    },
    init(project) {
      project.templates.push(templateTree(EVALS_TEMPLATE));
    },
    update: noOp(
      "The eval suite is owner-managed after init, including deletions; its package.json contribution enforces the eval/view scripts and keeps the seeded Promptfoo dependency fresh.",
    ),
    validate: validateEvals,
  };
}
