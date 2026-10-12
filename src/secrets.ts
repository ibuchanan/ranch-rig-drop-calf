import type { ProjectBlueprint } from "./project.ts";
import { templateTree } from "./templates.ts";
import { type Directory, dag } from "@dagger.io/dagger";
import { parse as parseToml } from "smol-toml";
import sortPackageJson from "sort-package-json";
import ts from "typescript";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { ParseError } from "./preclean.ts";

/** Owner declarations are init-only; helpers and the six dispatch scripts track policy. */
export const SECRETS_TEMPLATE = "templates/secretspec";
export const FORGE_VARIABLE_KEYS = "forge-variable-keys.json";
export const SECRETS_EXECUTABLES = [
  "scripts/env-var.sh",
  "scripts/forge-vars-from-secretspec.js",
] as const;
export const SECRETS_ASSETS = [
  "secretspec.toml",
  FORGE_VARIABLE_KEYS,
  ...SECRETS_EXECUTABLES,
] as const;

export function transformSecretsTemplate(
  path: string,
  contents: string,
  name: string,
): string {
  if (path !== "secretspec.toml") return contents;
  // JSON string escaping is compatible with TOML basic strings for project names.
  return contents.replaceAll('"[project-name]"', JSON.stringify(name));
}

/** This seeding boundary handles TOML name substitution and explicit helper modes. */
export async function copySecretsAssets(
  destination: Directory,
  source: Directory,
  name: string,
  paths: readonly string[] = SECRETS_ASSETS,
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    result = result.withNewFile(
      path,
      transformSecretsTemplate(path, await source.file(path).contents(), name),
      SECRETS_EXECUTABLES.includes(path as (typeof SECRETS_EXECUTABLES)[number])
        ? { permissions: 0o755 }
        : {},
    );
  }
  return result;
}

/** Variables expand in the inner shell, after SecretSpec injects them. */
function throughEnvVar(command: string): string {
  return `bash scripts/env-var.sh '${command}'`;
}

export const FORGE_SECRETS_SCRIPTS = {
  "forge:register": throughEnvVar("forge register"),
  "forge:deploy": throughEnvVar(
    'forge deploy --non-interactive --environment "$FORGE_ENVIRONMENT"',
  ),
  "forge:install": throughEnvVar(
    'forge install --non-interactive --confirm-scopes --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
  ),
  "forge:uninstall": throughEnvVar(
    'forge uninstall --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
  ),
  "forge:upgrade": throughEnvVar(
    'forge install --upgrade --non-interactive --confirm-scopes --site "$FORGE_SITE" --product "$FORGE_PRODUCT" --environment "$FORGE_ENVIRONMENT"',
  ),
  "forge:variables:set": "node scripts/forge-vars-from-secretspec.js",
} as const;

/** Never execute owner JavaScript to discover whether its legacy allowlist is empty. */
function guardLegacyAllowlist(contents: string): void {
  const source = ts.createSourceFile(
    "helper.js",
    contents,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  let unsafe = false;
  const visit = (node: ts.Node) => {
    if (ts.isIdentifier(node) && node.text === "APP_VARIABLE_KEYS") {
      const parent = node.parent;
      const emptyDeclaration =
        ts.isVariableDeclaration(parent) &&
        parent.name === node &&
        parent.initializer &&
        ts.isArrayLiteralExpression(parent.initializer) &&
        parent.initializer.elements.length === 0;
      const lengthRead =
        ts.isPropertyAccessExpression(parent) &&
        parent.expression === node &&
        parent.name.text === "length" &&
        ts.isBinaryExpression(parent.parent) &&
        parent.parent.left === parent &&
        parent.parent.operatorToken.kind ===
          ts.SyntaxKind.EqualsEqualsEqualsToken;
      const iteration =
        ts.isForOfStatement(parent) && parent.expression === node;
      if (!emptyDeclaration && !lengthRead && !iteration) unsafe = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  if (unsafe)
    throw new Error(
      `secrets: legacy APP_VARIABLE_KEYS in scripts/forge-vars-from-secretspec.js may contain owner keys. Move the keys to ${FORGE_VARIABLE_KEYS} and remove the embedded APP_VARIABLE_KEYS declaration and references before update.`,
    );
}

/** Apply tooling policy without creating, parsing, or rewriting owner declarations. */
export async function updateSecrets(directory: Directory): Promise<Directory> {
  const helper = SECRETS_EXECUTABLES[1];
  if (await directory.exists(helper))
    guardLegacyAllowlist(await directory.file(helper).contents());
  let packageContents: string | undefined;
  if (await directory.exists("package.json")) {
    const contents = await directory.file("package.json").contents();
    const pkg = parseObject("package.json", contents);
    const existing = pkg.scripts;
    if (
      existing !== undefined &&
      (existing === null ||
        typeof existing !== "object" ||
        Array.isArray(existing))
    )
      throw new ParseError("package.json", "scripts must be an object");
    const scripts = (existing ?? {}) as Record<string, unknown>;
    if (
      Object.entries(FORGE_SECRETS_SCRIPTS).some(
        ([key, value]) => scripts[key] !== value,
      )
    ) {
      Object.assign(scripts, FORGE_SECRETS_SCRIPTS);
      pkg.scripts = scripts;
      packageContents = sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
  const source = dag.currentModule().source().directory(SECRETS_TEMPLATE);
  let result = directory;
  for (const path of SECRETS_EXECUTABLES) {
    const wanted = await source.file(path).contents();
    if (
      !(await directory.exists(path)) ||
      (await directory.file(path).contents()) !== wanted ||
      (await directory.stat(path).permissions()) !== 0o755
    )
      result = result.withNewFile(path, wanted, { permissions: 0o755 });
  }
  return packageContents === undefined
    ? result
    : result.withNewFile("package.json", packageContents);
}

function parseForgeVariableKeys(contents: string): string[] {
  let keys: unknown;
  try {
    keys = JSON.parse(contents);
  } catch {
    throw new Error(`${FORGE_VARIABLE_KEYS}: invalid JSON`);
  }
  if (
    !Array.isArray(keys) ||
    keys.some(
      (key) => typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key),
    ) ||
    new Set(keys).size !== keys.length
  )
    throw new Error(
      `${FORGE_VARIABLE_KEYS}: expected an array of unique environment-variable names`,
    );
  if (keys.some((key) => key.startsWith("FORGE_")))
    throw new Error(
      `${FORGE_VARIABLE_KEYS}: FORGE_* keys target the CLI and must not be pushed as app variables`,
    );
  return keys;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Local structural acceptance only; never resolve values, run helpers, or contact Forge. */
export async function validateSecrets(
  directory: Directory,
): Promise<Validation> {
  if (!(await directory.exists("secretspec.toml")))
    return { status: "skipped", reason: "secretspec.toml is missing" };
  let config: Record<string, unknown>;
  try {
    config = parseToml(await directory.file("secretspec.toml").contents());
  } catch {
    // Parser diagnostics can include source lines; declarations may hold defaults.
    throw new Error("secretspec.toml: invalid TOML");
  }
  if (
    !isRecord(config.project) ||
    typeof config.project.name !== "string" ||
    !config.project.name.trim() ||
    config.project.revision !== "1.0"
  )
    throw new Error(
      'secretspec.toml: project.name must be nonempty and project.revision must be "1.0"',
    );
  if (!isRecord(config.profiles) || !isRecord(config.profiles.default))
    throw new Error(
      "secretspec.toml: profiles.default must be a table for the helpers' default profile",
    );
  for (const [name, profile] of Object.entries(config.profiles)) {
    if (!isRecord(profile))
      throw new Error(`secretspec.toml: profile ${name} must be a table`);
    for (const [key, declaration] of Object.entries(profile)) {
      if (!isRecord(declaration))
        throw new Error(
          `secretspec.toml: ${name}.${key} must be a declaration table`,
        );
      if (key === "defaults") continue;
      if (
        declaration.description !== undefined &&
        typeof declaration.description !== "string"
      )
        throw new Error(
          `secretspec.toml: ${name}.${key}.description must be a string`,
        );
      if (
        declaration.required !== undefined &&
        typeof declaration.required !== "boolean" &&
        !(
          Array.isArray(declaration.required) &&
          declaration.required.every((group) => typeof group === "string")
        )
      )
        throw new Error(
          `secretspec.toml: ${name}.${key}.required must be boolean or an array of group names`,
        );
      if (
        declaration.default !== undefined &&
        typeof declaration.default !== "string"
      )
        throw new Error(
          `secretspec.toml: ${name}.${key}.default must be a string`,
        );
    }
  }
  if (!(await directory.exists(FORGE_VARIABLE_KEYS)))
    throw new Error(
      `${FORGE_VARIABLE_KEYS} is missing; create an empty array or migrate the legacy allowlist`,
    );
  const keys = parseForgeVariableKeys(
    await directory.file(FORGE_VARIABLE_KEYS).contents(),
  );
  for (const key of keys)
    if (key === "defaults" || !Object.hasOwn(config.profiles.default, key))
      throw new Error(
        `${FORGE_VARIABLE_KEYS}: ${key} is not declared in secretspec.toml profiles.default`,
      );
  for (const path of SECRETS_EXECUTABLES) {
    if (!(await directory.exists(path))) throw new Error(`${path} is missing`);
    if (((await directory.stat(path).permissions()) & 0o111) === 0)
      throw new Error(`${path} is not executable`);
  }
  return { status: "validated" };
}

export function forgeSecrets(): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    Object.assign(project.packageJson.scripts, FORGE_SECRETS_SCRIPTS);
  };
  return {
    name: "secrets",
    documentation: {
      tools: [
        {
          name: "SecretSpec",
          url: "https://secretspec.dev",
          purpose:
            "Manages environment variable injection and secret validation for Forge CLI commands",
        },
        {
          name: "Atlassian Forge CLI",
          url: "https://developer.atlassian.com/platform/forge/cli-reference/",
          purpose:
            "Reference for forge register, deploy, install, and upgrade command syntax",
        },
      ],
      init: "Seed owner SecretSpec declarations and app-variable allowlist, executable helpers, and six Forge dispatch scripts.",
      update:
        "Enforce helper contents/modes and dispatch scripts; preserve declarations/allowlist, rejecting unmigrated embedded keys.",
      validate:
        "Parse TOML and allowlist, check helper presence and executable modes; no secret resolution or Forge execution.",
    },
    init(project) {
      seed(project);
      const name = project.packageJson.name;
      project.templates.push(
        templateTree(SECRETS_TEMPLATE, (destination, source) =>
          copySecretsAssets(destination, source, name),
        ),
      );
    },
    update: updateSecrets,
    validate: validateSecrets,
  };
}
