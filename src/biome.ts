import type { Container, Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import ts from "typescript";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import { copyTemplate } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const BIOME_TEMPLATE = "templates/biome";
export const BIOME_SCRIPTS = {
  format: "biome format --write",
  "format:check": "biome format",
  "lint:check": "biome lint",
  "lint:fix": "biome lint --write",
} as const;

const REPOSITORY = "/repo";

export function copyBiome(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(destination, source);
}

async function configPath(directory: Directory): Promise<string | undefined> {
  for (const path of ["biome.json", "biome.jsonc"])
    if (await directory.exists(path)) return path;
  return undefined;
}

function biomeContainer(version: string): Container {
  return nodeContainer().withExec([
    "npm",
    "install",
    "--global",
    "--no-fund",
    "--no-audit",
    `@biomejs/biome@${version}`,
  ]);
}

async function runBiome(
  container: Container,
  args: string[],
  verb: string,
): Promise<Container> {
  const result = container.withExec(["biome", ...args, "--colors=off"]);
  try {
    await result.stdout();
  } catch (error) {
    if (
      error instanceof Error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.trim()
    )
      throw new Error(
        `biome: ${verb} execution failed: ${error.stderr.trim()}`,
      );
    throw error;
  }
  return result;
}

/** Enforce only the dependency and four owned scripts; migrate owner configuration in isolation. */
export async function updateBiome(
  directory: Directory,
  version: string = TOOL_VERSIONS.biome,
): Promise<Directory> {
  let result = directory;
  if (await directory.exists("package.json")) {
    const contents = await directory.file("package.json").contents();
    const pkg = parseObject("package.json", contents);
    let changed = false;
    for (const [section, wanted] of [
      ["devDependencies", { "@biomejs/biome": version }],
      ["scripts", BIOME_SCRIPTS],
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
    if (changed)
      result = result.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      );
  }
  const path = await configPath(directory);
  if (!path) return result;
  const contents = await directory.file(path).contents();
  // migrate does not reject malformed JSONC when no migration rule matches it.
  const parsed = ts.parseConfigFileTextToJson(path, contents);
  if (parsed.error)
    throw new ParseError(
      path,
      ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n"),
    );
  if (
    parsed.config === null ||
    typeof parsed.config !== "object" ||
    Array.isArray(parsed.config)
  )
    throw new ParseError(path, "expected an object");
  const migrated = await runBiome(
    biomeContainer(version)
      .withMountedDirectory(REPOSITORY, directory)
      .withWorkdir(REPOSITORY),
    ["migrate", "--write", `--config-path=${path}`],
    "migration",
  );
  const updated = await migrated.file(`${REPOSITORY}/${path}`).contents();
  return updated === contents ? result : result.withNewFile(path, updated);
}

/** Load the root config and its references, without scanning or enforcing source-code quality. */
export async function validateBiome(
  directory: Directory,
  version: string = TOOL_VERSIONS.biome,
): Promise<Validation> {
  const path = await configPath(directory);
  if (!path)
    return {
      status: "skipped",
      reason: "biome.json and biome.jsonc are missing",
    };
  await runBiome(
    biomeContainer(version)
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
export function biomeToolchain(
  biomeVersion: string = TOOL_VERSIONS.biome,
): Capability {
  const seed: Capability["addTo"] = (project) => {
    project.packageJson.devDependencies["@biomejs/biome"] = biomeVersion;
    Object.assign(project.packageJson.scripts, BIOME_SCRIPTS);
  };
  return {
    name: "biome",
    templates: [BIOME_TEMPLATE],
    addTo: seed,
    init(project) {
      seed(project);
      project.templates.push(BIOME_TEMPLATE);
    },
    update: (directory) => updateBiome(directory, biomeVersion),
    validate: (directory) => validateBiome(directory, biomeVersion),
  };
}
