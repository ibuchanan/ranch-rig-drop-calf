import type { Directory } from "@dagger.io/dagger";
import { parse as parseToml } from "smol-toml";
import { type Capability, noOp, type Validation } from "../core/capability.ts";
import { ParseError, ValidationError } from "../core/errors.ts";
import { isPlainObject } from "../core/guards.ts";
import { templateTree } from "../core/templates.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

/** The owner's declarations are init-only; Fence Rider carries every helper. */
export const SECRETS_TEMPLATE = "templates/secretspec";
export const SECRETS_ASSETS = ["secretspec.toml"] as const;
export const FENCE_RIDER_PACKAGE = "fence-rider";

/** TOML basic strings forbid raw control characters (U+0000–U+001F, U+007F) plus `"` and `\`. */
const TOML_SHORT_ESCAPES: Record<string, string> = {
  "\b": "\\b",
  "\t": "\\t",
  "\n": "\\n",
  "\f": "\\f",
  "\r": "\\r",
};

const unicodeEscape = (codePoint: number) =>
  `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;

const isSurrogate = (codePoint: number) =>
  codePoint >= 0xd800 && codePoint <= 0xdfff;
const isControl = (codePoint: number) =>
  codePoint <= 0x1f || codePoint === 0x7f;

/** TOML `\uXXXX` escapes carry a Unicode scalar value, so an unpaired surrogate is unreachable. */
function escapeTomlCharacter(character: string): string {
  const codePoint = character.codePointAt(0) ?? 0;
  if (isSurrogate(codePoint))
    throw new ValidationError({
      source: "secrets",
      path: "secretspec.toml#project.name",
      discovered: `contains ${unicodeEscape(codePoint)}, an unpaired surrogate`,
      remedy: "rename the project with characters TOML can represent",
    });
  if (character === '"') return '\\"';
  if (character === "\\") return "\\\\";
  const short = TOML_SHORT_ESCAPES[character];
  if (short) return short;
  return isControl(codePoint) ? unicodeEscape(codePoint) : character;
}

function tomlBasicString(value: string): string {
  return `"${[...value].map(escapeTomlCharacter).join("")}"`;
}

export function transformSecretsTemplate(
  path: string,
  contents: string,
  name: string,
): string {
  if (path !== "secretspec.toml") return contents;
  return contents.replaceAll('"[project-name]"', tomlBasicString(name));
}

/** This seeding boundary handles TOML name substitution. */
export async function copySecretsAssets(
  destination: Directory,
  source: Directory,
  name: string,
  paths: readonly string[] = SECRETS_ASSETS,
): Promise<Directory> {
  let result = destination;
  for (const path of paths)
    result = result.withNewFile(
      path,
      transformSecretsTemplate(path, await source.file(path).contents(), name),
    );
  return result;
}

/** Fence Rider prints a script that runs Forge with resolved values; `sh -c` runs it only if printing succeeded. */
function throughFenceRider(command: string, forgeArgs = ""): string {
  const args = forgeArgs ? ` -- ${forgeArgs}` : "";
  return `cmd=$(fence-rider ${command}${args}) && sh -c "$cmd" sh`;
}

export const FORGE_SECRETS_SCRIPTS = {
  "forge:register": "forge register",
  "forge:deploy": throughFenceRider("deploy", "--non-interactive"),
  "forge:install": throughFenceRider(
    "install",
    "--confirm-scopes --non-interactive",
  ),
  "forge:uninstall": throughFenceRider("uninstall"),
  "forge:upgrade": throughFenceRider(
    "install",
    "--upgrade --confirm-scopes --non-interactive",
  ),
  "forge:variables:set": "fence-rider variables",
} as const;

function parseSecretspec(contents: string): Record<string, unknown> {
  try {
    return parseToml(contents);
  } catch {
    // Parser diagnostics can include source lines; declarations may hold defaults.
    throw new ParseError("secretspec.toml", "invalid TOML");
  }
}

function checkProject(project: unknown): void {
  if (
    !isPlainObject(project) ||
    typeof project.name !== "string" ||
    !project.name.trim() ||
    project.revision !== "1.0"
  )
    throw new ValidationError({
      source: "secrets",
      path: "secretspec.toml#project",
      discovered:
        'project.name must be nonempty and project.revision must be "1.0"',
      remedy: 'set a project name and revision = "1.0"',
    });
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
    throw new ValidationError({
      source: "secrets",
      path: `secretspec.toml#${path}.description`,
      discovered: "must be a string",
      remedy: "write the description as a TOML string",
    });
  if (!isOptional(declaration.required, isRequirement))
    throw new ValidationError({
      source: "secrets",
      path: `secretspec.toml#${path}.required`,
      discovered: "must be boolean or an array of group names",
      remedy: "use true, false, or a TOML array of group names",
    });
  if (!isOptional(declaration.default, isString))
    throw new ValidationError({
      source: "secrets",
      path: `secretspec.toml#${path}.default`,
      discovered: "must be a string",
      remedy: "write the default as a TOML string",
    });
}

/** Returns the default profile, which Fence Rider resolves. */
function checkProfiles(profiles: unknown): Record<string, unknown> {
  if (!isPlainObject(profiles) || !isPlainObject(profiles.default))
    throw new ValidationError({
      source: "secrets",
      path: "secretspec.toml#profiles.default",
      discovered: "must be a table for Fence Rider's default profile",
      remedy:
        "declare [profiles.default] with the secrets Fence Rider resolves",
    });
  for (const [name, profile] of Object.entries(profiles)) {
    if (!isPlainObject(profile))
      throw new ValidationError({
        source: "secrets",
        path: `secretspec.toml#profiles.${name}`,
        discovered: "must be a declaration table",
        remedy: `make ${name} a TOML table`,
      });
    for (const [key, declaration] of Object.entries(profile)) {
      if (!isPlainObject(declaration))
        throw new ValidationError({
          source: "secrets",
          path: `secretspec.toml#${name}.${key}`,
          discovered: "must be a declaration table",
          remedy: `declare ${key} as a table of declaration fields`,
        });
      if (key !== "defaults") checkDeclaration(`${name}.${key}`, declaration);
    }
  }
  return profiles.default;
}

const SCOPES = ["manifest", "runtime"] as const;

function checkScopeMember(
  scope: string,
  key: string,
  profile: Record<string, unknown>,
): void {
  if (key === "defaults" || !Object.hasOwn(profile, key))
    throw new ValidationError({
      source: "secrets",
      path: `secretspec.toml#scopes.${scope}`,
      discovered: `member ${key} is not declared in profiles.default`,
      remedy: `declare ${key} in [profiles.default] or remove it from the scope`,
    });
  if (scope === "runtime" && key.startsWith("FORGE_"))
    throw new ValidationError({
      source: "secrets",
      path: `secretspec.toml#scopes.runtime`,
      discovered: `FORGE_* keys target the CLI and must not be in scopes.runtime (${key})`,
      remedy: `move ${key} to scopes.manifest`,
    });
}

/** Scope members must be declared; runtime members upload, so local controls stay out. */
function checkScopes(scopes: unknown, profile: Record<string, unknown>): void {
  if (scopes === undefined) return;
  if (!isPlainObject(scopes))
    throw new ValidationError({
      source: "secrets",
      path: "secretspec.toml#scopes",
      discovered: "must be a table",
      remedy: "declare scopes.manifest and scopes.runtime as TOML tables",
    });
  for (const scope of SCOPES) {
    const members = isPlainObject(scopes[scope])
      ? scopes[scope].secrets
      : undefined;
    if (members === undefined) continue;
    if (!Array.isArray(members) || !members.every(isString))
      throw new ValidationError({
        source: "secrets",
        path: `secretspec.toml#scopes.${scope}.secrets`,
        discovered: "must be an array of names",
        remedy: "list declared secret names as a TOML string array",
      });
    for (const key of members) checkScopeMember(scope, key, profile);
  }
}

/** Local structural acceptance only; never resolve values, run Fence Rider, or contact Forge. */
async function validateSecrets(directory: Directory): Promise<Validation> {
  if (!(await directory.exists("secretspec.toml")))
    return { status: "skipped", reason: "secretspec.toml is missing" };
  const config = parseSecretspec(
    await directory.file("secretspec.toml").contents(),
  );
  checkProject(config.project);
  checkScopes(config.scopes, checkProfiles(config.profiles));
  return { status: "validated" };
}

export function forgeSecrets(): Capability {
  return {
    name: "secrets",
    documentation: {
      tools: [
        {
          name: "Fence Rider",
          url: "https://github.com/ibuchanan/ranch-rig-fence-rider",
          purpose:
            "Wraps the Forge CLI so each workflow runs with values resolved from secretspec.toml and uploads runtime variables encrypted",
        },
        {
          name: "SecretSpec",
          url: "https://secretspec.dev",
          purpose:
            "Declares local, manifest and runtime variables once and resolves them from each developer's chosen provider",
        },
        {
          name: "Atlassian Forge CLI",
          url: "https://developer.atlassian.com/platform/forge/cli-reference/",
          purpose:
            "Reference for forge register, deploy, install, and upgrade command syntax",
        },
      ],
      init: "Seed owner SecretSpec declarations and the six forge:* scripts that delegate to Fence Rider.",
      validate:
        "Parse TOML, check the default profile and that scope members are declared; no secret resolution or Forge execution.",
    },
    packageJson: {
      seed: {
        devDependencies: { [FENCE_RIDER_PACKAGE]: TOOL_VERSIONS.fenceRider },
      },
      policy: { scripts: FORGE_SECRETS_SCRIPTS },
    },
    init(project) {
      const name = project.packageJson.name;
      project.templates.push(
        templateTree(SECRETS_TEMPLATE, (destination, source) =>
          copySecretsAssets(destination, source, name),
        ),
      );
    },
    update: noOp(
      "Secrets owns only owner declarations; its package.json contribution enforces the forge:* scripts, and the Fence Rider GitHub reference is owner-managed.",
    ),
    validate: validateSecrets,
  };
}
