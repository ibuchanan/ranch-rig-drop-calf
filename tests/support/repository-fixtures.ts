import { afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RepositoryOptions } from "../../src/core/repository-types.ts";

// Call once per suite so cleanup state is never shared between suites.
export function repositoryWorkspaces() {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0))
      rmSync(root, { recursive: true, force: true });
  });
  return () => {
    const scratch = join(import.meta.dir, "../../.scratch");
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, "tmp_rovo_repository_"));
    roots.push(root);
    const options: RepositoryOptions = {
      operation: "init",
      branch: "main",
      authorName: "Test",
      authorEmail: "test@example.com",
    };
    return { root, options };
  };
}
