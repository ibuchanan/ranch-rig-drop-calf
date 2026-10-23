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
import { isPlainObject } from "../core/guards.ts";
import { readPackageJson } from "../core/package-json.ts";
import {
  type PackageManagerOption,
  runScript,
} from "../core/package-manager.ts";
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

function expectObject(path: string, value: unknown): Record<string, unknown> {
  if (!isPlainObject(value)) throw new ParseError(path, "expected an object");
  return value;
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
  const parsed = expectObject(path, getNodeValue(tree));
  if (parsed.compilerOptions !== undefined)
    expectObject(`${path}.compilerOptions`, parsed.compilerOptions);
  return parsed;
}

type ConfigPath = (typeof TYPESCRIPT_CONFIGS)[number];

/** What the project's declared dependencies and runtime imply for compiler policy. */
type Traits = {
  bun: boolean;
  tsdown: boolean;
  vitest: boolean;
  bunTypes: boolean;
};

/** One slice of owned `compilerOptions`; later layers override earlier ones. */
type Layer = (traits: Traits, modern: boolean) => Record<string, unknown>;

const MODERN_MODULES: Layer = (_traits, modern) =>
  modern ? { module: "ESNext", moduleResolution: "Bundler" } : {};

const BUN_COMPILER: Layer = ({ bun }) =>
  bun ? { noEmit: true, allowImportingTsExtensions: true, types: ["bun"] } : {};

const TYPECHECK_COMPILER: Layer = ({ bun, bunTypes }, modern) => ({
  rootDir: ".",
  module: "ESNext",
  moduleResolution: modern ? "Bundler" : "Node",
  types: bun ? ["bun"] : ["node", ...(bunTypes ? ["bun"] : [])],
});

/** The settings Drop Calf owns in one tsconfig file. */
type ConfigPolicy = {
  /** Whether bundler-style module resolution applies to this file. */
  modern: (traits: Traits) => boolean;
  compilerOptions: readonly Layer[];
  include: (traits: Traits) => string[];
  /** Owned top-level keys other than `include`, in the order they are enforced. */
  extra: Record<string, unknown>;
};

const BASE_POLICY: ConfigPolicy = {
  modern: ({ bun, tsdown }) => bun || tsdown,
  compilerOptions: [MODERN_MODULES, BUN_COMPILER],
  include: () => ["src"],
  extra: {},
};

const CONFIG_POLICIES: Record<ConfigPath, ConfigPolicy> = {
  "tsconfig.json": BASE_POLICY,
  "tsconfig.declarations.json": {
    ...BASE_POLICY,
    extra: { extends: "./tsconfig.json" },
  },
  "tsconfig.typecheck.json": {
    modern: ({ bun, tsdown, vitest }) => bun || tsdown || vitest,
    compilerOptions: [MODERN_MODULES, BUN_COMPILER, TYPECHECK_COMPILER],
    include: ({ vitest }) => [
      "src",
      "test",
      "tests",
      ...(vitest ? ["vitest.config.ts"] : []),
    ],
    extra: {
      extends: "./tsconfig.json",
      exclude: ["node_modules", "dist", "coverage", "specs"],
    },
  },
};

type Field = { keys: string[]; wanted: unknown };

/** Value at `keys` in a parsed config, or undefined when any step is missing. */
const valueAt = (config: Record<string, unknown>, keys: string[]): unknown =>
  keys.reduce<unknown>(
    (node, key) => (isPlainObject(node) ? node[key] : undefined),
    config,
  );

/** Enforce owned settings with surgical JSONC edits; all other options and comments survive. */
export function reconcileTypeScriptConfig(
  path: ConfigPath,
  contents: string,
  baseline: string,
  devDependencies: Record<string, unknown>,
  runtime = "node",
): string {
  const current = configObject(path, contents);
  const seed = configObject(path, baseline);
  const traits: Traits = {
    bun: runtime === "bun",
    tsdown: Object.hasOwn(devDependencies, "tsdown"),
    vitest: Object.hasOwn(devDependencies, "vitest"),
    bunTypes: Object.hasOwn(devDependencies, "@types/bun"),
  };
  const policy = CONFIG_POLICIES[path];
  const modern = policy.modern(traits);
  const compilerOptions = Object.assign(
    {},
    expectObject(path, seed.compilerOptions),
    ...policy.compilerOptions.map((layer) => layer(traits, modern)),
  );
  const fields: Field[] = [
    ...Object.entries(compilerOptions).map(([key, wanted]) => ({
      keys: ["compilerOptions", key],
      wanted,
    })),
    { keys: ["include"], wanted: policy.include(traits) },
    ...Object.entries(policy.extra).map(([key, wanted]) => ({
      keys: [key],
      wanted,
    })),
  ];
  const formattingOptions = {
    insertSpaces: true,
    tabSize: 2,
    eol: contents.includes("\r\n") ? "\r\n" : "\n",
  };
  return fields
    .filter(
      ({ keys, wanted }) =>
        JSON.stringify(valueAt(current, keys)) !== JSON.stringify(wanted),
    )
    .reduce(
      (text, { keys, wanted }) =>
        applyEdits(text, modify(text, keys, wanted, { formattingOptions })),
      contents,
    );
}

/** The declarations config exists only for projects that build declarations with tsdown. */
const applicableConfigs = (declarations: boolean) =>
  TYPESCRIPT_CONFIGS.filter(
    (path) => declarations || path !== "tsconfig.declarations.json",
  );

/** Declared dependencies select compiler policy; package.json itself is contributed. */
async function updateTypeScript(
  directory: Directory,
  runtime: string,
): Promise<Directory> {
  let result = directory;
  const pkg = await readPackageJson(directory);
  const dependencies = expectObject(
    "package.json.devDependencies",
    pkg?.devDependencies === undefined ? {} : pkg.devDependencies,
  );
  const source = dag.currentModule().source().directory(templateFor(runtime));
  const tsdown = Object.hasOwn(dependencies, "tsdown");
  for (const path of applicableConfigs(tsdown)) {
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
  const required = applicableConfigs(
    await directory.exists("tsconfig.declarations.json"),
  );
  const present = await Promise.all(
    required.map((path) => directory.exists(path)),
  );
  const missing = required.filter((_, index) => !present[index]);
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
  packageManager = "npm",
}: PackageManagerOption & { ownsBuild?: boolean } = {}): Capability {
  const runtime = packageManager === "bun" ? "bun" : "node";
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
          "lint:check:typecheck": runScript(packageManager, "typecheck"),
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
