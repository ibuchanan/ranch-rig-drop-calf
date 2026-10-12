import { type Directory, dag, type Secret } from "@dagger.io/dagger";
import { isCollection, isMap, isScalar, parseDocument, visit } from "yaml";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** Only numeric pins have a deterministic Forge runtime major without version resolution. */
export function forgeRuntimeFromNvmrc(contents: string): string {
  const match = contents.trim().match(/^v?([1-9]\d*)(?:\.\d+){0,2}$/);
  if (!match)
    throw new ParseError(
      ".nvmrc",
      "Forge runtime update requires a numeric Node version (for example 24 or v22.12.0); replace aliases or ranges with a numeric pin.",
    );
  return `nodejs${match[1]}.x`;
}

/** Enforce the owned runtime key without sorting or replacing the rest of the manifest. */
export function reconcileForgeRuntime(
  contents: string,
  runtime: string,
): string {
  const document = parseDocument(contents, { keepSourceTokens: true });
  if (document.errors.length)
    throw new ParseError(
      "manifest.yml",
      document.errors.map((error) => error.message).join("; "),
    );
  for (const path of [[], ["app"], ["app", "runtime"]]) {
    const node = document.getIn(path, true);
    if (isScalar(node) && node.value === null) {
      const map = document.createNode({});
      map.comment = node.comment;
      map.commentBefore = node.commentBefore;
      document.setIn(path, map);
    } else if (node !== undefined && !isMap(node))
      throw new ParseError(
        "manifest.yml",
        `expected a mapping at ${path.join(".") || "document root"}`,
      );
  }
  const path = ["app", "runtime", "name"];
  const current = document.getIn(path);
  if (current === runtime) return contents;
  const app = document.get("app", true);
  const indent =
    isMap(app) && app.srcToken?.type === "block-map" ? app.srcToken.indent : 2;
  document.setIn(path, runtime);
  // YAML attaches inline block-collection comments to the value. Move only
  // source-confirmed inline comments onto the key so serialization keeps them inline.
  visit(document, {
    Pair(_key, pair) {
      if (!isScalar(pair.key) || !isCollection(pair.value) || pair.value.flow)
        return;
      const separator = pair.srcToken?.sep ?? [];
      const inline = separator.findIndex((token) => token.type === "comment");
      const newline = separator.findIndex((token) => token.type === "newline");
      if (inline < 0 || (newline >= 0 && inline > newline)) return;
      const comment = separator[inline]?.source.slice(1);
      if (pair.value.commentBefore === comment) {
        pair.key.comment = comment;
        pair.value.commentBefore = null;
      }
    },
  });
  let result = document.toString({ indent, lineWidth: 0 });
  if (!contents.endsWith("\n")) result = result.slice(0, -1);
  if (contents.includes("\r\n")) result = result.replaceAll("\n", "\r\n");
  return result;
}

/** Node runs first in the Forge profile; this capability never creates either file. */
export async function updateForgeManifest(
  directory: Directory,
): Promise<Directory> {
  if (
    !(await directory.exists("manifest.yml")) ||
    !(await directory.exists(".nvmrc"))
  )
    return directory;
  const runtime = forgeRuntimeFromNvmrc(
    await directory.file(".nvmrc").contents(),
  );
  const contents = await directory.file("manifest.yml").contents();
  const reconciled = reconcileForgeRuntime(contents, runtime);
  return reconciled === contents
    ? directory
    : directory.withNewFile("manifest.yml", reconciled);
}

/** Run the consuming tool as-is, not --fix or a comparison with the Node baseline. */
export async function validateForgeManifest(
  directory: Directory,
  forgeEmail?: Secret,
  forgeApiToken?: Secret,
  version: string = TOOL_VERSIONS.forgeCli,
): Promise<Validation> {
  if (!(await directory.exists("manifest.yml")))
    return { status: "skipped", reason: "manifest.yml is missing" };
  if (!forgeEmail || !forgeApiToken)
    return {
      status: "failed",
      reason:
        "forge-manifest: forge lint requires authentication; supply both --forge-email and --forge-api-token as Dagger Secrets. Missing credentials are an execution prerequisite failure, not a manifest acceptance verdict.",
    };
  const cli = "/tools/node_modules/@forge/cli/out/bin/cli.js";
  const container = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withEnvVariable("CI", "1")
    .withWorkdir("/tools")
    .withExec(["bun", "add", "--ignore-scripts", `@forge/cli@${version}`])
    .withExec([
      "bun",
      "run",
      cli,
      "settings",
      "set",
      "usage-analytics",
      "false",
    ])
    .withSecretVariable("FORGE_EMAIL", forgeEmail)
    .withSecretVariable("FORGE_API_TOKEN", forgeApiToken)
    .withMountedDirectory("/repo", directory, { readOnly: true })
    .withWorkdir("/repo")
    .withExec(["bun", "run", cli, "lint", "--environment", "development"]);
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
      return {
        status: "failed",
        reason: `forge-manifest: forge lint execution failed: ${diagnostic || error.message}`,
      };
    }
    throw error;
  }
  return { status: "validated" };
}

export function forgeManifest(
  forgeEmail?: Secret,
  forgeApiToken?: Secret,
): Capability {
  return {
    name: "forge-manifest",
    init: noOp(
      "The Forge manifest is supplied by forge create or the owner; Drop Calf does not seed app identity or module wiring.",
    ),
    update: updateForgeManifest,
    validate: (directory) =>
      validateForgeManifest(directory, forgeEmail, forgeApiToken),
  };
}
