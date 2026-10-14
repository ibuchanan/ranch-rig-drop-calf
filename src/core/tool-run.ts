import { type Container, dag } from "@dagger.io/dagger";
import { NODE_MAJOR, TOOL_VERSIONS } from "./versions.ts";

/** Where validators mount the repository under review. */
export const REPOSITORY = "/repo";
/** Where `bunTools` installs packages; run them from `${TOOLS}/node_modules`. */
export const TOOLS = "/tools";

/**
 * The Node baseline as a native Dagger container. This is the one place the
 * Node image is chosen, so a containerized tool runs the same major the file
 * pins promise rather than whatever the host has installed. The `node` image
 * carries `git`, which containerized commands dispatch through.
 */
export function nodeContainer(): Container {
  return dag.container().from(`node:${NODE_MAJOR}`);
}

/**
 * The Node baseline with pinned Bun and `packages` installed into `TOOLS`,
 * without running package install scripts. Run tools with
 * `bun run --no-install`, leaving the workdir at `TOOLS`.
 */
export function bunTools(...packages: string[]): Container {
  return nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withWorkdir(TOOLS)
    .withExec(["bun", "add", "--ignore-scripts", ...packages]);
}

/** The Node baseline with `packages` installed globally, for tools invoked by binary name. */
export function npmTools(...packages: string[]): Container {
  return nodeContainer().withExec([
    "npm",
    "install",
    "--global",
    "--no-fund",
    "--no-audit",
    ...packages,
  ]);
}

/** The tool's own output when Dagger carries it, otherwise the error message. */
function diagnostic(error: Error): string {
  // The generated module SDK does not re-export ExecError, but it carries both streams.
  const streams = error as Error & { stdout?: unknown; stderr?: unknown };
  return (
    [streams.stdout, streams.stderr]
      .map((stream) => (typeof stream === "string" ? stream.trim() : ""))
      .filter(Boolean)
      .join("\n") || error.message
  );
}

/**
 * Evaluate `container` and return it. When execution fails, throw
 * `${label} execution failed: <diagnostic>`. `validateCapabilities` reports
 * the throw as `failed`, so validators never build failure results themselves.
 */
export async function runTool(
  container: Container,
  label: string,
): Promise<Container> {
  try {
    await container.stdout();
  } catch (error) {
    if (error instanceof Error)
      throw new Error(`${label} execution failed: ${diagnostic(error)}`);
    throw error;
  }
  return container;
}
