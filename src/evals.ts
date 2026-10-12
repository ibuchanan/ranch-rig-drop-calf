import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import type { ProjectBlueprint } from "./project.ts";
import { templateTree } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const EVALS_TEMPLATE = "templates/promptfoo";
export const EVALS_CONFIG = "promptfooconfig.yaml";
export const EVALS_SCRIPTS = {
  eval: "promptfoo eval",
  view: "promptfoo view",
} as const;

export async function updateEvals(
  directory: Directory,
  version: string = TOOL_VERSIONS.promptfoo,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  let changed = false;
  for (const [section, wanted] of [
    ["scripts", EVALS_SCRIPTS],
    ["devDependencies", { promptfoo: version }],
  ] as const) {
    const existing = pkg[section];
    if (
      existing !== undefined &&
      (existing === null ||
        typeof existing !== "object" ||
        Array.isArray(existing))
    )
      throw new ParseError("package.json", `${section} must be an object`);
    const fields = (existing ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(wanted)) {
      if (fields[key] === value) continue;
      fields[key] = value;
      changed = true;
    }
    pkg[section] = fields;
  }
  return changed
    ? directory.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      )
    : directory;
}

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
  const seed: (project: ProjectBlueprint) => void = (project) => {
    Object.assign(project.packageJson.scripts, EVALS_SCRIPTS);
    project.packageJson.devDependencies.promptfoo = version;
  };
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
      update:
        "Enforce Promptfoo and eval/view scripts; preserve the owner-managed suite and its deletions.",
      validate:
        "Use Promptfoo's native config/schema validator to load suite references; no model calls or assertion execution.",
    },
    selection: { with: true, without: true, default: false },
    init(project) {
      seed(project);
      project.templates.push(templateTree(EVALS_TEMPLATE));
    },
    update: (directory) => updateEvals(directory, version),
    validate: (directory) => validateEvals(directory, version),
  };
}
