import { type Capability, noOp } from "./capability.ts";
import { TOOL_VERSIONS } from "./versions.ts";

/** The rules ship in a package; only dependency references and scripts are maintained. */
export const AST_GREP_PACKAGE = "@ast-grep/cli";
export const PRELINT_PACKAGE = "@forge-ahead/prelint";

/** The scan exclusions are enforced as part of the canonical script. */
const PRELINT_GLOBS = ["!specs/**", "!node_modules/**"] as const;
const PRELINT_CONFIG = `./node_modules/${PRELINT_PACKAGE}/sgconfig.ecosol.yml`;
export const PRELINT_COMMAND = `ast-grep scan ${PRELINT_GLOBS.map((glob) => `--globs '${glob}'`).join(" ")} --config ${PRELINT_CONFIG}`;
export const PRELINT_SCRIPTS = {
  "lint:prelint": PRELINT_COMMAND,
  "lint:forge": "forge lint",
} as const;

export function prelint(): Capability {
  return {
    name: "prelint",
    documentation: {
      tools: [
        {
          name: "ast-grep",
          url: "https://ast-grep.github.io/",
          purpose:
            "AST-based pattern scanner for semantic code analysis and linting",
        },
        {
          name: "@forge-ahead/prelint",
          url: "https://github.com/ibuchanan/tool-forge-prelint-ast-grep",
          purpose:
            "Forge app linting rules for manifest, module wiring, and handler patterns",
        },
      ],
    },
    // Git-hooks alone owns lint; prelint contributes only named subtasks.
    packageJson: {
      seed: {
        devDependencies: {
          [AST_GREP_PACKAGE]: TOOL_VERSIONS.astGrep,
          [PRELINT_PACKAGE]: TOOL_VERSIONS.forgePrelint,
        },
      },
      policy: {
        scripts: PRELINT_SCRIPTS,
      },
    },
    init: noOp(
      "Prelint has no repository-local configuration to seed; its rules ship in the dependency package, and its package.json contribution supplies the tool dependencies and scripts.",
    ),
    update: noOp(
      "Prelint owns no files; its package.json contribution enforces the lint subtasks and keeps the seeded ast-grep dependency fresh; the @forge-ahead/prelint GitHub reference is owner-managed.",
    ),
    validate: noOp(
      "Prelint has no repository-local configuration to validate; its rules ship in the dependency package. Source scanning belongs to the lint workflow.",
    ),
  };
}
