import { type Directory, dag } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { nodeContainer } from "./node.ts";
import { templateTree } from "./templates.ts";
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

export async function validateEvals(
  directory: Directory,
  version: string = TOOL_VERSIONS.promptfoo,
): Promise<Validation> {
  if (!(await directory.exists(EVALS_CONFIG)))
    return { status: "skipped", reason: `${EVALS_CONFIG} is missing` };
  const container = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withWorkdir("/tools")
    .withExec(["bun", "add", "--ignore-scripts", `promptfoo@${version}`])
    .withEnvVariable("PROMPTFOO_DISABLE_TELEMETRY", "1")
    .withEnvVariable("PROMPTFOO_DISABLE_UPDATE", "1")
    .withEnvVariable("PROMPTFOO_CONFIG_DIR", "/tmp/promptfoo")
    .withEnvVariable("PROMPTFOO_LOG_DIR", "/tmp/promptfoo/logs")
    .withMountedDirectory("/repo", directory, { readOnly: true })
    .withNewFile("/tools/validate.mjs", EVALS_VALIDATOR)
    .withWorkdir("/repo")
    .withExec(["bun", "run", "--no-install", "/tools/validate.mjs"]);
  try {
    await container.stdout();
  } catch (error) {
    if (error instanceof Error) {
      const diagnostic = ["stdout", "stderr"]
        .map((key) =>
          key in error
            ? String((error as unknown as Record<string, unknown>)[key]).trim()
            : "",
        )
        .filter(Boolean)
        .join("\n");
      throw new Error(
        `evals: validation execution failed: ${diagnostic || error.message}`,
      );
    }
    throw error;
  }
  return { status: "validated" };
}

export function evals(version: string = TOOL_VERSIONS.promptfoo): Capability {
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
      policy: {
        scripts: EVALS_SCRIPTS,
        devDependencies: { promptfoo: version },
      },
    },
    init(project) {
      project.templates.push(templateTree(EVALS_TEMPLATE));
    },
    update: noOp(
      "The eval suite is owner-managed after init, including deletions; its package.json contribution enforces Promptfoo and the eval/view scripts.",
    ),
    validate: (directory) => validateEvals(directory, version),
  };
}
