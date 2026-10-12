import type { ProjectBlueprint } from "./project.ts";
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
import sortPackageJson from "sort-package-json";
import type { Capability, Validation } from "./capability.ts";
import { parseObject } from "./init.ts";
import { nodeContainer } from "./node.ts";
import { ParseError } from "./preclean.ts";
import { copyTemplate, templateTree } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const TYPESCRIPT_TEMPLATE = "templates/typescript";
export const TYPESCRIPT_CONFIGS = [
  "tsconfig.json",
  "tsconfig.typecheck.json",
  "tsconfig.declarations.json",
] as const;
export const TYPESCRIPT_SCRIPTS = {
  build: "tsc --project tsconfig.json",
  typecheck: "tsc --project tsconfig.typecheck.json --noEmit",
} as const;

export function copyTypeScript(
  destination: Directory,
  source: Directory,
): Directory {
  return copyTemplate(
    destination,
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
): string {
  const current = configObject(path, contents);
  const seed = configObject(path, baseline);
  const vitest = Object.hasOwn(devDependencies, "vitest");
  const tsdown = Object.hasOwn(devDependencies, "tsdown");
  const check = path === "tsconfig.typecheck.json";
  const declarations = path === "tsconfig.declarations.json";
  const modern = tsdown || (check && vitest);
  const compilerOptions = {
    ...object(path, seed.compilerOptions),
    ...(modern ? { module: "ESNext", moduleResolution: "Bundler" } : {}),
    ...(check
      ? {
          rootDir: vitest || tsdown ? "." : "src",
          module: modern ? "ESNext" : "CommonJS",
          moduleResolution: modern ? "Bundler" : "Node",
        }
      : {}),
  };
  const fields: [string[], unknown][] = Object.entries(compilerOptions).map(
    ([key, value]) => [["compilerOptions", key], value],
  );
  fields.push([
    ["include"],
    ["src", ...(check && vitest ? ["test", "tests", "vitest.config.ts"] : [])],
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

/** Dependencies select compiler policy; library-build remains the sole owner of its build script. */
export async function updateTypeScript(
  directory: Directory,
  version: string = TOOL_VERSIONS.typescript,
  ownsBuild = true,
): Promise<Directory> {
  let result = directory;
  let dependencies: Record<string, unknown> = {};
  if (await directory.exists("package.json")) {
    const contents = await directory.file("package.json").contents();
    const pkg = parseObject("package.json", contents);
    dependencies = object(
      "package.json.devDependencies",
      pkg.devDependencies === undefined ? {} : pkg.devDependencies,
    );
    const scripts = object(
      "package.json.scripts",
      pkg.scripts === undefined ? {} : pkg.scripts,
    );
    const wanted = {
      typecheck: TYPESCRIPT_SCRIPTS.typecheck,
      ...(ownsBuild && !Object.hasOwn(dependencies, "tsdown")
        ? { build: TYPESCRIPT_SCRIPTS.build }
        : {}),
    };
    const changed =
      dependencies.typescript !== version ||
      Object.entries(wanted).some(([key, value]) => scripts[key] !== value);
    dependencies.typescript = version;
    Object.assign(scripts, wanted);
    pkg.devDependencies = dependencies;
    pkg.scripts = scripts;
    if (changed)
      result = result.withNewFile(
        "package.json",
        sortPackageJson(`${JSON.stringify(pkg, null, 2)}\n`),
      );
  }
  const source = dag.currentModule().source().directory(TYPESCRIPT_TEMPLATE);
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
    );
    if (!exists || updated !== contents)
      result = result.withNewFile(path, updated);
  }
  return result;
}

/** Configuration acceptance only: never compile source, apply policy, or export container changes. */
export async function validateTypeScript(
  directory: Directory,
  version: string = TOOL_VERSIONS.typescript,
): Promise<Validation> {
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
  const container = nodeContainer()
    .withExec([
      "npm",
      "install",
      "--global",
      "--no-fund",
      "--no-audit",
      `typescript@${version}`,
    ])
    .withMountedDirectory("/repo", directory, { readOnly: true })
    .withWorkdir("/repo");
  for (const path of required) {
    try {
      await container
        .withExec(["tsc", "--showConfig", "--project", path])
        .stdout();
    } catch (error) {
      if (error instanceof Error) {
        const diagnostic = ["stdout", "stderr"]
          .map((key) =>
            key in error
              ? String(
                  (error as unknown as Record<string, unknown>)[key],
                ).trim()
              : "",
          )
          .filter(Boolean)
          .join("\n");
        throw new Error(
          `typescript: ${path} validation execution failed: ${diagnostic || error.message}`,
        );
      }
      throw error;
    }
  }
  return { status: "validated" };
}

export function typeScriptToolchain(
  tsVersion: string = TOOL_VERSIONS.typescript,
  ownsBuild = true,
): Capability {
  const seed: (project: ProjectBlueprint) => void = (project) => {
    project.packageJson.devDependencies.typescript = tsVersion;
    project.packageJson.scripts.typecheck = TYPESCRIPT_SCRIPTS.typecheck;
    if (ownsBuild) project.packageJson.scripts.build = TYPESCRIPT_SCRIPTS.build;
  };
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
        : "Seed TypeScript, typecheck, and compiler configuration including declarations; library-build owns build.",
      update: ownsBuild
        ? "Enforce TypeScript/typecheck and compiler policy; maintain tsc build unless tsdown is declared."
        : "Enforce TypeScript/typecheck and dependency-selected compiler policy; leave build to library-build.",
      validate:
        "Run tsc --showConfig for applicable compiler configs, without compiling source or declarations.",
    },
    init(project) {
      seed(project);
      project.templates.push(templateTree(TYPESCRIPT_TEMPLATE, copyTypeScript));
    },
    update: (directory) => updateTypeScript(directory, tsVersion, ownsBuild),
    validate: (directory) => validateTypeScript(directory, tsVersion),
  };
}
