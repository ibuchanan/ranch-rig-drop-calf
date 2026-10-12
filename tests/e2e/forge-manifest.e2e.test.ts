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

const enabled = process.env.DROP_CALF_FORGE_MANIFEST_E2E === "1";
const repo = join(import.meta.dir, "../..");
function report(directory: string): { status: string; reason?: string } {
  return JSON.parse(
    execFileSync(
      "dagger",
      [
        "--progress",
        "plain",
        "call",
        "-m",
        repo,
        "validate-forge-manifest",
        "--directory",
        directory,
      ],
      {
        cwd: repo,
        encoding: "utf8",
        timeout: 300_000,
        stdio: "pipe",
        env: { ...process.env, DAGGER_NO_NAG: "1" },
      },
    ),
  );
}
// This covers the credential prerequisite, not authenticated Forge acceptance.
// No host credentials are read or forwarded implicitly.
test.skipIf(!enabled)(
  "Dagger Forge lint reports its authentication requirement without changing input",
  () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_forge_manifest_"));
    try {
      mkdirSync(join(root, "src"));
      const source =
        "export const handler = () => ({ statusCode: 200, body: 'ok' });\n";
      const manifest = `# Owner settings
app:
  id: ari:cloud:ecosystem::app/00000000-0000-4000-8000-000000000000
  runtime:
    name: 'nodejs22.x' # owner runtime
    memoryMB: 512
modules:
  function:
    - key: handler
      handler: index.handler
  webtrigger:
    - key: webhook
      function: handler
permissions:
  scopes: []
`;
      writeFileSync(join(root, "src/index.js"), source);
      writeFileSync(join(root, "package.json"), '{"private":true}');
      writeFileSync(join(root, "manifest.yml"), manifest);
      writeFileSync(join(root, ".nvmrc"), "24\n");
      const result = report(root);
      expect(result.status, result.reason).toBe("failed");
      expect(result.reason).toContain(
        "supply both --forge-email and --forge-api-token",
      );
      expect(readFileSync(join(root, "manifest.yml"), "utf8")).toBe(manifest);
      expect(readFileSync(join(root, "src/index.js"), "utf8")).toBe(source);
      expect(readFileSync(join(root, ".nvmrc"), "utf8")).toBe("24\n");
      rmSync(join(root, "manifest.yml"));
      expect(report(root)).toEqual({
        status: "skipped",
        reason: "manifest.yml is missing",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  600_000,
);
