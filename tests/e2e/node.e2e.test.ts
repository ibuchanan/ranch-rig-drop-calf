import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { NODE_FORGE_RUNTIME } from "../../src/node.ts";

// Requires a Dagger engine, but never registers or deploys a Forge app.
const enabled = process.env.DROP_CALF_NODE_E2E === "1";
const repo = join(import.meta.dir, "../..");

test.skipIf(!enabled)(
  "Dagger init normalizes a scaffold manifest without changing other settings",
  () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_node_"));
    const scaffold = join(root, "scaffold");
    const output = join(root, "output");
    try {
      mkdirSync(scaffold);
      writeFileSync(join(scaffold, "package.json"), '{"name":"sample"}\n');
      writeFileSync(
        join(scaffold, "manifest.yml"),
        `# Scaffold
modules: {}
app:
  id: 'example' # registration
  runtime:
    name: "nodejs22.x" # scaffold runtime
    memoryMB: 512
    architecture: arm64
`,
      );
      execFileSync(
        "dagger",
        [
          "--progress",
          "plain",
          "call",
          "-m",
          repo,
          "init",
          "--directory",
          scaffold,
          "--profile",
          "forge-app",
          "--owner",
          "tester",
          "export",
          "--path",
          output,
        ],
        { cwd: repo, encoding: "utf8", timeout: 120_000, stdio: "pipe" },
      );
      expect(
        readFileSync(join(output, "manifest.yml"), "utf8"),
      ).toBe(`# Scaffold
modules: {}
app:
  id: 'example' # registration
  runtime:
    name: "${NODE_FORGE_RUNTIME}" # scaffold runtime
    memoryMB: 512
    architecture: arm64
`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
