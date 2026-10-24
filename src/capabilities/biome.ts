import type { Container, Directory } from "@dagger.io/dagger";
import ts from "typescript";
import type { Capability, Validation } from "../core/capability.ts";
import { ParseError } from "../core/errors.ts";
import { isPlainObject } from "../core/guards.ts";
import {
  type PackageManagerOption,
  runScript,
} from "../core/package-manager.ts";
import { templateTree } from "../core/templates.ts";
import { npmTools, REPOSITORY, runTool } from "../core/tool-run.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export const BIOME_TEMPLATE = "templates/biome";
export const BIOME_SCRIPTS = {
  format: "biome format --write",
  "format:check": "biome format",
  "lint:check:biome": "biome lint",
  "lint:check:format": "npm run format:check",
  "lint:fix": "biome lint --write",
} as const;

async function configPath(directory: Directory): Promise<string | undefined> {
  for (const path of ["biome.json", "biome.jsonc"])
    if (await directory.exists(path)) return path;
  return undefined;
}

function biomeContainer(): Container {
  return npmTools(`@biomejs/biome@${TOOL_VERSIONS.biome}`);
}

function runBiome(
  container: Container,
  args: string[],
  verb: string,
): Promise<Container> {
  return runTool(
    container.withExec(["biome", ...args, "--colors=off"]),
    `biome: ${verb}`,
  );
}

/** Let Biome migrate an existing root config in isolation; package.json is contributed. */
async function updateBiome(directory: Directory): Promise<Directory> {
  const path = await configPath(directory);
  if (!path) return directory;
  const contents = await directory.file(path).contents();
  // migrate does not reject malformed JSONC when no migration rule matches it.
  const parsed = ts.parseConfigFileTextToJson(path, contents);
  if (parsed.error)
    throw new ParseError(
      path,
      ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
    );
  if (!isPlainObject(parsed.config))
    throw new ParseError(path, "expected an object");
  const migrated = await runBiome(
    biomeContainer()
      .withMountedDirectory(REPOSITORY, directory)
      .withWorkdir(REPOSITORY),
    ["migrate", "--write", `--config-path=${path}`],
    "migration",
  );
  const updated = await migrated.file(`${REPOSITORY}/${path}`).contents();
  return updated === contents
    ? directory
    : directory.withNewFile(path, updated);
}

/** Load the root config and its references, without scanning or enforcing source-code quality. */
async function validateBiome(directory: Directory): Promise<Validation> {
  const path = await configPath(directory);
  if (!path)
    return {
      status: "skipped",
      reason: "biome.json and biome.jsonc are missing",
    };
  await runBiome(
    biomeContainer()
      .withMountedDirectory(REPOSITORY, directory, { readOnly: true })
      .withWorkdir(REPOSITORY),
    [
      "check",
      `--config-path=${path}`,
      "--formatter-enabled=false",
      "--linter-enabled=false",
      "--assist-enabled=false",
      "--no-errors-on-unmatched",
      path,
    ],
    "validation",
  );
  return { status: "validated" };
}

/** Configuration and EditorConfig are owner-managed after init; only Biome migrates the root config. */
export function biomeToolchain({
  packageManager = "npm",
}: PackageManagerOption = {}): Capability {
  return {
    name: "biome",
    documentation: {
      tools: [
        {
          name: "Biome",
          url: "https://biomejs.dev/",
          purpose:
            "Formats and lints JavaScript, TypeScript, and supported configuration files.",
        },
      ],
      init: "Seed Biome, formatting/lint subtasks, biome.jsonc, and .editorconfig.",
      update:
        "Let Biome migrate an existing root config, preserving EditorConfig.",
      validate:
        "Load the root config and references with Biome, without scanning source quality.",
    },
    packageJson: {
      seed: { devDependencies: { "@biomejs/biome": TOOL_VERSIONS.biome } },
      policy: {
        scripts: {
          ...BIOME_SCRIPTS,
          "lint:check:format": runScript(packageManager, "format:check"),
        },
      },
    },
    init(project) {
      project.templates.push(templateTree(BIOME_TEMPLATE));
    },
    update: updateBiome,
    validate: validateBiome,
  };
}
