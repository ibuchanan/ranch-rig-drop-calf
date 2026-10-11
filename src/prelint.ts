import type { Directory } from "@dagger.io/dagger";
import { type Capability, expandCapability } from "./capability.ts";
import { nodeContainer } from "./node.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/**
 * The Forge prelint workflow: ast-grep plus the Forge rule set, the scan
 * command that runs them, and the `lint` chain the hooks dispatch through.
 *
 * `vendor/explore-forge-confluence-okf-producer` keeps the rules in the
 * `@forge-ahead/prelint` package (`github:ibuchanan/tool-forge-prelint-ast-grep`)
 * and runs them with `ast-grep scan … --config
 * ./node_modules/@forge-ahead/prelint/sgconfig.ecosol.yml`, skipping `specs/`
 * and `node_modules/`. There is no config to author here — the rules ship
 * inside the package — so the capability only pins the two devDependencies and
 * the command that reads them.
 *
 * `forge lint` shares this module because the two run together in the `lint`
 * chain; `git-hooks` later replaces that chain with `lefthook run lint`.
 */
export const AST_GREP_PACKAGE = "@ast-grep/cli";
export const PRELINT_PACKAGE = "@forge-ahead/prelint";

/** The globs the scan skips, in the order the example passes them. */
export const PRELINT_GLOBS = ["!specs/**", "!node_modules/**"] as const;

/** The rule set the scan reads; it ships inside `@forge-ahead/prelint`. */
export const PRELINT_CONFIG = `./node_modules/${PRELINT_PACKAGE}/sgconfig.ecosol.yml`;

function scanCommand(config: string, executable = "ast-grep"): string {
  const globs = PRELINT_GLOBS.map((glob) => `--globs '${glob}'`).join(" ");
  return `${executable} scan ${globs} --config ${config}`;
}

/** The repo-facing command `prelint()` writes into `lint:prelint`. */
export const PRELINT_COMMAND = scanCommand(PRELINT_CONFIG);

export function prelint(
  astGrepVersion = TOOL_VERSIONS.astGrep,
  rulesPackage = TOOL_VERSIONS.forgePrelint,
): Capability {
  return expandCapability(
    "prelint",
    "16-prelint",
    {
      addTo(project) {
        project.packageJson.devDependencies[AST_GREP_PACKAGE] = astGrepVersion;
        project.packageJson.devDependencies[PRELINT_PACKAGE] = rulesPackage;
        project.packageJson.scripts["lint:prelint"] = PRELINT_COMMAND;
        project.packageJson.scripts["lint:forge"] = "forge lint";
        project.packageJson.scripts.lint =
          "npm run lint:prelint && npm run lint:check && npm run lint:forge";
      },
    },
    validatePrelint,
  );
}

export type PrelintValidation =
  | { status: "validated" }
  | { status: "skipped"; reason: string };

const REPOSITORY = "/repo";
const TOOLS = "/prelint-tools";
const EXIT_MARKER = "ast-grep exit=";

/** The scan `validatePrelint` runs, resolved against the container's tool tree. */
export const PRELINT_SCAN = scanCommand(
  `${TOOLS}/node_modules/${PRELINT_PACKAGE}/sgconfig.ecosol.yml`,
  `${TOOLS}/node_modules/.bin/ast-grep`,
);

/**
 * Run a repository through the Forge prelint rules without changing its files.
 *
 * The rules are installed in a container from the same package `prelint` pins,
 * so the verdict depends on the rules under review rather than on whatever the
 * host has installed. The repository is mounted read-only; nothing is written
 * back. A repository that never opted into `lint:prelint` is reported as
 * skipped rather than failed.
 */
export async function validatePrelint(
  directory: Directory,
): Promise<PrelintValidation> {
  if (!(await directory.exists("package.json")))
    return { status: "skipped", reason: "package.json is missing" };
  const manifest = JSON.parse(
    await directory.file("package.json").contents(),
  ) as { scripts?: Record<string, string> };
  if (typeof manifest?.scripts?.["lint:prelint"] !== "string")
    return { status: "skipped", reason: "lint:prelint is missing" };
  const tools = `${JSON.stringify(
    {
      name: "drop-calf-prelint",
      private: true,
      version: "0.0.0",
      devDependencies: {
        [AST_GREP_PACKAGE]: TOOL_VERSIONS.astGrep,
        [PRELINT_PACKAGE]: TOOL_VERSIONS.forgePrelint,
      },
    },
    null,
    2,
  )}\n`;
  const container = nodeContainer()
    .withNewFile(`${TOOLS}/package.json`, tools)
    .withWorkdir(TOOLS)
    .withExec(["npm", "install", "--no-fund", "--no-audit"])
    .withMountedDirectory(REPOSITORY, directory)
    .withWorkdir(REPOSITORY);
  // `echo` runs last so the command's own exit code survives without failing
  // the exec, and `2>&1` carries ast-grep's own diagnosis into the report: a
  // rule that fails is reported here, not as a bare Dagger exec error.
  const report = await container
    .withExec(["sh", "-c", `${PRELINT_SCAN} 2>&1; echo "${EXIT_MARKER}$?"`])
    .stdout();
  const code = report.trim().match(/ast-grep exit=(\d+)$/)?.[1];
  if (code !== "0")
    throw new Error(`ast-grep validation failed: ${report.trim()}`);
  return { status: "validated" };
}
