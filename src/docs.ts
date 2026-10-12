import { type Directory, dag } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import { copyTemplate } from "./templates.ts";
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

/** Documentation and lint configuration are owner-managed; only the tools and script track policy. */
export async function updateDocs(
  directory: Directory,
  cspellVersion: string = TOOL_VERSIONS.cspell,
  markdownlintVersion: string = TOOL_VERSIONS.markdownlintCli2,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const contents = await directory.file("package.json").contents();
  const pkg = parseObject("package.json", contents);
  let changed = false;
  for (const [section, wanted] of [
    ["scripts", { "lint:docs": DOCS_COMMAND }],
    [
      "devDependencies",
      { cspell: cspellVersion, "markdownlint-cli2": markdownlintVersion },
    ],
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
  const container = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withWorkdir("/tools")
    .withExec([
      "bun",
      "add",
      "--ignore-scripts",
      `cspell@${cspellVersion}`,
      `markdownlint-cli2@${markdownlintVersion}`,
    ])
    .withMountedDirectory("/repo", directory, { readOnly: true })
    .withWorkdir("/repo")
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
        `docs: validation execution failed: ${diagnostic || error.message}`,
      );
    }
    throw error;
  }
  return { status: "validated" };
}

export function docsLinting(
  cspellVersion: string = TOOL_VERSIONS.cspell,
  markdownlintVersion: string = TOOL_VERSIONS.markdownlintCli2,
): Capability {
  const seed: Capability["addTo"] = (project) => {
    project.packageJson.scripts["lint:docs"] = DOCS_COMMAND;
    Object.assign(project.packageJson.devDependencies, {
      cspell: cspellVersion,
      "markdownlint-cli2": markdownlintVersion,
    });
  };
  return {
    name: "docs",
    templates: [DOCS_TEMPLATE],
    addTo: seed,
    init(project) {
      seed(project);
      project.templates.push(DOCS_TEMPLATE);
    },
    update: (directory) =>
      updateDocs(directory, cspellVersion, markdownlintVersion),
    validate: (directory) =>
      validateDocs(directory, cspellVersion, markdownlintVersion),
  };
}
