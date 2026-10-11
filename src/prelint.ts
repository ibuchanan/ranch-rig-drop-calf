import type { Directory } from "@dagger.io/dagger";
import sortPackageJson from "sort-package-json";
import { type Capability, noOp } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** The rules ship in a package; only dependency references and scripts are maintained. */
export const AST_GREP_PACKAGE = "@ast-grep/cli";
export const PRELINT_PACKAGE = "@forge-ahead/prelint";

/** The scan exclusions are enforced as part of the canonical script. */
export const PRELINT_GLOBS = ["!specs/**", "!node_modules/**"] as const;
export const PRELINT_CONFIG = `./node_modules/${PRELINT_PACKAGE}/sgconfig.ecosol.yml`;
export const PRELINT_COMMAND = `ast-grep scan ${PRELINT_GLOBS.map((glob) => `--globs '${glob}'`).join(" ")} --config ${PRELINT_CONFIG}`;
export const PRELINT_SCRIPTS = {
  "lint:prelint": PRELINT_COMMAND,
  "lint:forge": "forge lint",
} as const;

const PRELINT_VALIDATION = noOp(
  "Prelint has no repository-local configuration to validate; its rules ship in the dependency package. Source scanning belongs to the lint workflow.",
);

/** Enforce only the tool dependencies and named subtasks; git-hooks alone owns lint. */
export async function updatePrelint(
  directory: Directory,
  astGrepVersion: string = TOOL_VERSIONS.astGrep,
  rulesPackage: string = TOOL_VERSIONS.forgePrelint,
): Promise<Directory> {
  if (!(await directory.exists("package.json"))) return directory;
  const pkg = parseObject(
    "package.json",
    await directory.file("package.json").contents(),
  );
  let changed = false;
  for (const [section, wanted] of [
    [
      "devDependencies",
      { [AST_GREP_PACKAGE]: astGrepVersion, [PRELINT_PACKAGE]: rulesPackage },
    ],
    ["scripts", PRELINT_SCRIPTS],
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

export function prelint(
  astGrepVersion: string = TOOL_VERSIONS.astGrep,
  rulesPackage: string = TOOL_VERSIONS.forgePrelint,
): Capability {
  return {
    name: "prelint",
    // Retain legacy blueprint contributions until the old shape is contracted.
    addTo(project) {
      project.packageJson.devDependencies[AST_GREP_PACKAGE] = astGrepVersion;
      project.packageJson.devDependencies[PRELINT_PACKAGE] = rulesPackage;
      Object.assign(project.packageJson.scripts, PRELINT_SCRIPTS);
    },
    init: noOp(
      "Prelint has no repository-local configuration to seed; its rules ship in the dependency package, and update maintains the tool dependencies and scripts.",
    ),
    update: (directory) =>
      updatePrelint(directory, astGrepVersion, rulesPackage),
    validate: PRELINT_VALIDATION,
  };
}

export type PrelintValidation = { status: "skipped"; reason: string };

/** Compatibility entry point: report the same explicit no-op without reading the repository. */
export async function validatePrelint(
  _directory: Directory,
): Promise<PrelintValidation> {
  return { status: "skipped", reason: PRELINT_VALIDATION.reason };
}
