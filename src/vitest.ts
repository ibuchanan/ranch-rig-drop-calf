import type { Directory } from "@dagger.io/dagger";
import { type Capability, noOp, type Validation } from "./capability.ts";
import { templateTree } from "./templates.ts";
import { bunTools, REPOSITORY, runTool, TOOLS } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

const VITEST_TEMPLATE = "templates/vitest";
const VITEST_CONFIG = "vitest.config.ts";
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

async function validateVitest(directory: Directory): Promise<Validation> {
  if (!(await directory.exists(VITEST_CONFIG)))
    return { status: "skipped", reason: `${VITEST_CONFIG} is missing` };
  const version = TOOL_VERSIONS.vitest;
  const tools = bunTools(`vitest@${version}`, `@vitest/coverage-v8@${version}`);
  const repository = directory.withDirectory(
    "node_modules/vitest",
    tools.directory(`${TOOLS}/node_modules/vitest`),
  );
  const container = tools
    .withMountedDirectory(REPOSITORY, repository, { readOnly: true })
    .withMountedDirectory(
      "/node_modules",
      tools.directory(`${TOOLS}/node_modules`),
      { readOnly: true },
    )
    .withNewFile(`${TOOLS}/validate.mjs`, VITEST_VALIDATOR)
    .withWorkdir(REPOSITORY)
    .withExec(["bun", "run", "--no-install", `${TOOLS}/validate.mjs`]);
  await runTool(container, "vitest: validation");
  return { status: "validated" };
}

export function vitestTesting(): Capability {
  const version = TOOL_VERSIONS.vitest;
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
      seed: {
        devDependencies: { vitest: version, "@vitest/coverage-v8": version },
      },
      policy: {
        scripts: VITEST_SCRIPTS,
      },
    },
    init(project) {
      project.templates.push(templateTree(VITEST_TEMPLATE));
    },
    update: noOp(
      "Vitest configuration and test sources are owner-managed after init; its package.json contribution enforces the test scripts and keeps the seeded runner and coverage provider fresh.",
    ),
    validate: validateVitest,
  };
}
