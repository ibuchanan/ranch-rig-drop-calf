import { type Directory, dag } from "@dagger.io/dagger";
import { parse as parseToml } from "smol-toml";
import ts from "typescript";
import type { Capability, Validation } from "./capability.ts";
import { templateTree } from "./templates.ts";

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
async function updateSecrets(directory: Directory): Promise<Directory> {
  const helper = SECRETS_EXECUTABLES[1];
  if (await directory.exists(helper))
    guardLegacyAllowlist(await directory.file(helper).contents());
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
  return result;
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

function parseSecretspec(contents: string): Record<string, unknown> {
  try {
    return parseToml(contents);
  } catch {
    // Parser diagnostics can include source lines; declarations may hold defaults.
    throw new Error("secretspec.toml: invalid TOML");
  }
}

function checkProject(project: unknown): void {
  if (
    !isRecord(project) ||
    typeof project.name !== "string" ||
    !project.name.trim() ||
    project.revision !== "1.0"
  )
    throw new Error(
      'secretspec.toml: project.name must be nonempty and project.revision must be "1.0"',
    );
}

const isOptional = (value: unknown, valid: (value: unknown) => boolean) =>
  value === undefined || valid(value);
const isString = (value: unknown) => typeof value === "string";
const isRequirement = (value: unknown) =>
  typeof value === "boolean" || (Array.isArray(value) && value.every(isString));

function checkDeclaration(
  path: string,
  declaration: Record<string, unknown>,
): void {
  if (!isOptional(declaration.description, isString))
    throw new Error(`secretspec.toml: ${path}.description must be a string`);
  if (!isOptional(declaration.required, isRequirement))
    throw new Error(
      `secretspec.toml: ${path}.required must be boolean or an array of group names`,
    );
  if (!isOptional(declaration.default, isString))
    throw new Error(`secretspec.toml: ${path}.default must be a string`);
}

/** Returns the default profile, which the helpers resolve allowlisted keys from. */
function checkProfiles(profiles: unknown): Record<string, unknown> {
  if (!isRecord(profiles) || !isRecord(profiles.default))
    throw new Error(
      "secretspec.toml: profiles.default must be a table for the helpers' default profile",
    );
  for (const [name, profile] of Object.entries(profiles)) {
    if (!isRecord(profile))
      throw new Error(`secretspec.toml: profile ${name} must be a table`);
    for (const [key, declaration] of Object.entries(profile)) {
      if (!isRecord(declaration))
        throw new Error(
          `secretspec.toml: ${name}.${key} must be a declaration table`,
        );
      if (key !== "defaults") checkDeclaration(`${name}.${key}`, declaration);
    }
  }
  return profiles.default;
}

async function readForgeVariableKeys(directory: Directory): Promise<string[]> {
  if (!(await directory.exists(FORGE_VARIABLE_KEYS)))
    throw new Error(
      `${FORGE_VARIABLE_KEYS} is missing; create an empty array or migrate the legacy allowlist`,
    );
  return parseForgeVariableKeys(
    await directory.file(FORGE_VARIABLE_KEYS).contents(),
  );
}

function checkKeysDeclared(
  keys: readonly string[],
  profile: Record<string, unknown>,
): void {
  for (const key of keys)
    if (key === "defaults" || !Object.hasOwn(profile, key))
      throw new Error(
        `${FORGE_VARIABLE_KEYS}: ${key} is not declared in secretspec.toml profiles.default`,
      );
}

async function checkExecutables(directory: Directory): Promise<void> {
  for (const path of SECRETS_EXECUTABLES) {
    if (!(await directory.exists(path))) throw new Error(`${path} is missing`);
    if (((await directory.stat(path).permissions()) & 0o111) === 0)
      throw new Error(`${path} is not executable`);
  }
}

/** Local structural acceptance only; never resolve values, run helpers, or contact Forge. */
async function validateSecrets(directory: Directory): Promise<Validation> {
  if (!(await directory.exists("secretspec.toml")))
    return { status: "skipped", reason: "secretspec.toml is missing" };
  const config = parseSecretspec(
    await directory.file("secretspec.toml").contents(),
  );
  checkProject(config.project);
  const defaultProfile = checkProfiles(config.profiles);
  checkKeysDeclared(await readForgeVariableKeys(directory), defaultProfile);
  await checkExecutables(directory);
  return { status: "validated" };
}

export function forgeSecrets(): Capability {
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
        "Enforce helper contents/modes; preserve declarations/allowlist, rejecting unmigrated embedded keys.",
      validate:
        "Parse TOML and allowlist, check helper presence and executable modes; no secret resolution or Forge execution.",
    },
    packageJson: { policy: { scripts: FORGE_SECRETS_SCRIPTS } },
    init(project) {
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
