import type { Directory } from "@dagger.io/dagger";
import { parse as parseToml } from "smol-toml";
import { type Capability, noOp, type Validation } from "../core/capability.ts";
import { templateTree } from "../core/templates.ts";
import { TOOL_VERSIONS } from "../core/versions.ts";
import { updatePackageLicense } from "./package-metadata.ts";

export const BUN_TEMPLATE = "templates/bun";

async function validateBun(directory: Directory): Promise<Validation> {
  if (!(await directory.exists("bunfig.toml")))
    return { status: "skipped", reason: "bunfig.toml is missing" };
  // Starting Bun would execute owner-configured preloads, even with --eval.
  try {
    parseToml(await directory.file("bunfig.toml").contents());
  } catch {
    throw new Error("bun: bunfig.toml contains invalid TOML");
  }
  return { status: "validated" };
}

export function bunBaseline(): Capability {
  return {
    name: "bun",
    documentation: {
      tools: [
        {
          name: "Bun",
          url: "https://bun.com/docs",
          purpose:
            "Runs TypeScript tools, installs dependencies, and executes package scripts.",
        },
      ],
      init: "Seed the Bun packageManager pin and bunfig.toml with the public registry and Bun script runtime; no Node version or type pin.",
      update:
        "Maintain the Bun packageManager pin and derive package license from catalog; preserve owner-managed Bun configuration and existing Node files.",
      validate:
        "Parse bunfig.toml as TOML without starting Bun, loading preloads, or installing dependencies; syntax validation does not check Bun option semantics.",
    },
    packageJson: { policy: { packageManager: `bun@${TOOL_VERSIONS.bun}` } },
    init(project) {
      project.templates.push(templateTree(BUN_TEMPLATE));
    },
    update: (directory) => updatePackageLicense(directory, "bun"),
    validate: validateBun,
  };
}

export function bunBuild(): Capability {
  return {
    name: "bun-build",
    documentation: {
      tools: [
        {
          name: "Bun compiler",
          url: "https://bun.com/docs/bundler/executables",
          purpose:
            "Compiles a TypeScript CLI into a standalone executable for the current platform.",
        },
      ],
    },
    packageJson: {
      policy: {
        scripts: {
          build: "bun build --compile ./src/index.ts --outfile ./dist/cli",
        },
      },
    },
    init: noOp(
      "Bun build owns no source files; its package.json contribution supplies binary compilation from src/index.ts to dist/cli.",
    ),
    update: noOp(
      "Bun build owns no files; its package.json contribution enforces the binary build command without compiling source.",
    ),
    validate: noOp(
      "Bun compilation executes source bundling and emits a binary; it belongs to the build workflow, not configuration validation.",
    ),
  };
}
