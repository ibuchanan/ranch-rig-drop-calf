import { type Directory, dag } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { nodeContainer } from "./node.ts";
import { templateTree } from "./templates.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export const VITEST_TEMPLATE = "templates/vitest";
export const VITEST_CONFIG = "vitest.config.ts";
export const VITEST_SCRIPTS = {
  test: "vitest run --passWithNoTests",
  "test:watch": "vitest watch --passWithNoTests",
  "test:coverage": "vitest run --coverage --passWithNoTests",
} as const;

// Use Vitest's file-discovery API, never collect/import test modules or run coverage cleanup.
const VITEST_VALIDATOR = `
import { createVitest } from 'vitest/node';
const ctx = await createVitest({ root: '/repo', config: '/repo/vitest.config.ts', watch: false, configLoader: 'runner' });
try {
  const files = await ctx.globTestSpecifications();
  const options = ctx.config.coverage;
  const builtin = options.provider === 'v8' || options.provider === 'istanbul';
  const moduleId = builtin ? '@vitest/coverage-' + options.provider : options.customProviderModule;
  const { default: coverageModule } = await ctx.import(moduleId);
  const provider = await coverageModule.getProvider();
  if (builtin && provider.version !== ctx.version)
    throw new Error(moduleId + '@' + provider.version + ' is incompatible with vitest@' + ctx.version);
  await provider.initialize(ctx);
  provider.resolveOptions();
  for (const file of files) console.log(file.moduleId);
} finally {
  await ctx.close();
}
`;

export async function validateVitest(
  directory: Directory,
  version: string = TOOL_VERSIONS.vitest,
): Promise<Validation> {
  if (!(await directory.exists(VITEST_CONFIG)))
    return { status: "skipped", reason: `${VITEST_CONFIG} is missing` };
  const tools = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withWorkdir("/tools")
    .withExec([
      "bun",
      "add",
      "--ignore-scripts",
      `vitest@${version}`,
      `@vitest/coverage-v8@${version}`,
    ]);
  const repository = directory.withDirectory(
    "node_modules/vitest",
    tools.directory("/tools/node_modules/vitest"),
  );
  const container = tools
    .withMountedDirectory("/repo", repository, { readOnly: true })
    .withMountedDirectory(
      "/node_modules",
      tools.directory("/tools/node_modules"),
      { readOnly: true },
    )
    .withNewFile("/tools/validate.mjs", VITEST_VALIDATOR)
    .withWorkdir("/repo")
    .withExec(["bun", "run", "--no-install", "/tools/validate.mjs"]);
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
      throw new Error(
        `vitest: validation execution failed: ${diagnostic || error.message}`,
      );
    }
    throw error;
  }
  return { status: "validated" };
}

export function vitestTesting(
  version: string = TOOL_VERSIONS.vitest,
): Capability {
  return {
    name: "test",
    documentation: {
      tools: [
        {
          name: "Vitest",
          url: "https://vitest.dev/",
          purpose: "Runs Forge app tests with mocking and V8 coverage support.",
        },
      ],
      init: "Seed Vitest, matching V8 coverage, test/watch/coverage scripts, and vitest.config.ts; no sample tests.",
      validate:
        "Load Vitest config, discover test files, and initialize coverage configuration without executing tests.",
    },
    packageJson: {
      policy: {
        scripts: VITEST_SCRIPTS,
        devDependencies: { vitest: version, "@vitest/coverage-v8": version },
      },
    },
    init(project) {
      project.templates.push(templateTree(VITEST_TEMPLATE));
    },
    update: noOp(
      "Vitest configuration and test sources are owner-managed after init; its package.json contribution enforces the runner, matching coverage provider, and test scripts.",
    ),
    validate: (directory) => validateVitest(directory, version),
  };
}
