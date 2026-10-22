import { type Directory, dag } from "@dagger.io/dagger";
import {
  applyEdits,
  getNodeValue,
  type ParseError as JsonError,
  modify,
  type Node,
  parseTree,
  printParseErrorCode,
} from "jsonc-parser";
import type { Capability, Validation } from "../core/capability.ts";
import { ParseError } from "../core/errors.ts";
import { readPackageJson } from "../core/package-json.ts";
import { templateTree } from "../core/templates.ts";
import { npmTools, REPOSITORY, runTool } from "../core/tool-run.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";

export const TYPESCRIPT_TEMPLATE = "templates/typescript";
/** Bun projects share no Forge or Node assumptions, so they seed their own compiler base. */
export const TYPESCRIPT_BUN_TEMPLATE = "templates/typescript-bun";
export const TYPESCRIPT_CONFIGS = [
  "tsconfig.json",
  "tsconfig.typecheck.json",
  "tsconfig.declarations.json",
] as const;
export const TYPESCRIPT_SCRIPTS = {
  build: "tsc --project tsconfig.json",
  typecheck: "tsc --project tsconfig.typecheck.json --noEmit",
  "lint:check:typecheck": "npm run typecheck",
} as const;

const templateFor = (runtime: string) =>
  runtime === "bun" ? TYPESCRIPT_BUN_TEMPLATE : TYPESCRIPT_TEMPLATE;

/** Seed the uncomposed pair; update adds the declarations config for tsdown projects. */
function seedTypeScript(destination: Directory, source: Directory): Directory {
  return destination.withDirectory(
    ".",
    source.withoutFile("tsconfig.declarations.json"),
  );
}

function object(path: string, value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new ParseError(path, "expected an object");
  return value as Record<string, unknown>;
}

function configObject(path: string, contents: string): Record<string, unknown> {
  const errors: JsonError[] = [];
  const tree = parseTree(contents, errors, { allowTrailingComma: true });
  if (errors.length)
    throw new ParseError(
      path,
      errors.map((error) => printParseErrorCode(error.error)).join("; "),
    );
  // Duplicate keys make targeted edits ambiguous; reject them rather than choosing a winner.
  function check(node: Node) {
    if (node.type === "object") {
      const keys =
        node.children?.map((property) => property.children?.[0]?.value) ?? [];
      if (new Set(keys).size !== keys.length)
        throw new ParseError(path, "duplicate object keys");
    }
    for (const child of node.children ?? []) check(child);
  }
  if (!tree) throw new ParseError(path, "expected an object");
  check(tree);
  const parsed = object(path, getNodeValue(tree));
  if (parsed.compilerOptions !== undefined)
    object(`${path}.compilerOptions`, parsed.compilerOptions);
  return parsed;
}

/** Enforce owned settings with surgical JSONC edits; all other options and comments survive. */
export function reconcileTypeScriptConfig(
  path: (typeof TYPESCRIPT_CONFIGS)[number],
  contents: string,
  baseline: string,
  devDependencies: Record<string, unknown>,
  runtime = "node",
): string {
  const current = configObject(path, contents);
  const seed = configObject(path, baseline);
  const vitest = Object.hasOwn(devDependencies, "vitest");
  const tsdown = Object.hasOwn(devDependencies, "tsdown");
  const check = path === "tsconfig.typecheck.json";
  const declarations = path === "tsconfig.declarations.json";
  const bun = runtime === "bun";
  const modern = bun || tsdown || (check && vitest);
  const compilerOptions = {
    ...object(path, seed.compilerOptions),
    ...(modern ? { module: "ESNext", moduleResolution: "Bundler" } : {}),
    ...(bun
      ? { noEmit: true, allowImportingTsExtensions: true, types: ["bun"] }
      : {}),
    ...(check
      ? {
          rootDir: ".",
          module: "ESNext",
          moduleResolution: modern ? "Bundler" : "Node",
          types: bun
            ? ["bun"]
            : [
                "node",
                ...(Object.hasOwn(devDependencies, "@types/bun")
                  ? ["bun"]
                  : []),
              ],
        }
      : {}),
  };
  const fields: [string[], unknown][] = Object.entries(compilerOptions).map(
    ([key, value]) => [["compilerOptions", key], value],
  );
  fields.push([
    ["include"],
    [
      "src",
      ...(check
        ? ["test", "tests", ...(vitest ? ["vitest.config.ts"] : [])]
        : []),
    ],
  ]);
  if (check) {
    fields.push([["extends"], "./tsconfig.json"]);
    fields.push([["exclude"], ["node_modules", "dist", "coverage", "specs"]]);
  }
  if (declarations) {
    fields.push([["extends"], "./tsconfig.json"]);
  }
  let result = contents;
  for (const [keys, wanted] of fields) {
    const existing =
      keys.length === 2
        ? (current.compilerOptions as Record<string, unknown> | undefined)?.[
            keys[1] ?? ""
          ]
        : current[keys[0] ?? ""];
    if (JSON.stringify(existing) === JSON.stringify(wanted)) continue;
    result = applyEdits(
      result,
      modify(result, keys, wanted, {
        formattingOptions: {
          insertSpaces: true,
          tabSize: 2,
          eol: contents.includes("\r\n") ? "\r\n" : "\n",
        },
      }),
    );
  }
  return result;
}

/** Declared dependencies select compiler policy; package.json itself is contributed. */
async function updateTypeScript(
  directory: Directory,
  runtime: string,
): Promise<Directory> {
  let result = directory;
  const pkg = await readPackageJson(directory);
  const dependencies = object(
    "package.json.devDependencies",
    pkg?.devDependencies === undefined ? {} : pkg.devDependencies,
  );
  const source = dag.currentModule().source().directory(templateFor(runtime));
  const tsdown = Object.hasOwn(dependencies, "tsdown");
  for (const path of TYPESCRIPT_CONFIGS) {
    // declarations config is only seeded for tsdown projects
    if (path === "tsconfig.declarations.json" && !tsdown) continue;
    const baseline = await source.file(path).contents();
    const exists = await directory.exists(path);
    const contents = exists ? await directory.file(path).contents() : baseline;
    const updated = reconcileTypeScriptConfig(
      path,
      contents,
      baseline,
      dependencies,
      runtime,
    );
    if (!exists || updated !== contents)
      result = result.withNewFile(path, updated);
  }
  return result;
}

/** Configuration acceptance only: never compile source, apply policy, or export container changes. */
async function validateTypeScript(directory: Directory): Promise<Validation> {
  const declarations = await directory.exists("tsconfig.declarations.json");
  const missing: string[] = [];
  const required: string[] = [];
  for (const path of TYPESCRIPT_CONFIGS) {
    if (path === "tsconfig.declarations.json" && !declarations) continue;
    required.push(path);
    if (!(await directory.exists(path))) missing.push(path);
  }
  if (missing.length)
    return {
      status: missing.length === required.length ? "skipped" : "failed",
      reason: `Missing TypeScript configuration: ${missing.join(", ")}`,
    };
  const container = npmTools(`typescript@${TOOL_VERSIONS.typescript}`)
    .withMountedDirectory(REPOSITORY, directory, { readOnly: true })
    .withWorkdir(REPOSITORY);
  for (const path of required)
    await runTool(
      container.withExec(["tsc", "--showConfig", "--project", path]),
      `typescript: ${path} validation`,
    );
  return { status: "validated" };
}

/** `ownsBuild: false` leaves the build script to the selected build capability. */
export function typeScriptToolchain({
  ownsBuild = true,
  runtime = "node",
} = {}): Capability {
  return {
    name: "typescript",
    documentation: {
      tools: [
        {
          name: "TypeScript",
          url: "https://www.typescriptlang.org/docs/",
          purpose:
            "Type-checks source and emits JavaScript or library declarations.",
        },
      ],
      init: ownsBuild
        ? "Seed TypeScript, typecheck/build scripts, and compiler configuration (declarations config only with tsdown)."
        : "Seed TypeScript, typecheck, and compiler configuration; the selected build capability owns build (declarations only with tsdown).",
      update:
        "Reconcile compiler configuration with policy selected by declared dependencies.",
      validate:
        "Run tsc --showConfig for applicable compiler configs, without compiling source or declarations.",
    },
    packageJson: {
      seed: { devDependencies: { typescript: TOOL_VERSIONS.typescript } },
      policy: {
        scripts: {
          typecheck: TYPESCRIPT_SCRIPTS.typecheck,
          "lint:check:typecheck": `${runtime === "bun" ? "bun" : "npm"} run typecheck`,
          // A separate build capability owns build when selected.
          ...(ownsBuild ? { build: TYPESCRIPT_SCRIPTS.build } : {}),
        },
      },
    },
    init(project) {
      project.templates.push(
        templateTree(templateFor(runtime), seedTypeScript),
      );
    },
    update: (directory) => updateTypeScript(directory, runtime),
    validate: validateTypeScript,
  };
}
