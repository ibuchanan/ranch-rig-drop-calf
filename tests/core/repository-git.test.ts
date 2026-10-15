import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  finishRepository,
  git,
  INIT_COMMIT,
  INITIAL_COMMIT,
  prepareRepository,
  type RepositoryOptions,
  type RepositoryResult,
} from "../../src/core/repository-git.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(operation: "init" | "update" = "init") {
  mkdirSync(join(import.meta.dir, "../../.scratch"), { recursive: true });
  const root = mkdtempSync(
    join(import.meta.dir, "../../.scratch/tmp_rovo_git_"),
  );
  roots.push(root);
  const repo = join(root, "repo"),
    tree = join(root, "tree"),
    output = join(root, "output");
  mkdirSync(repo);
  mkdirSync(tree);
  const options: RepositoryOptions = {
    operation,
    branch: "main",
    authorName: "Test",
    authorEmail: "test@example.com",
  };
  return { root, repo, tree, output, options };
}

test("init bundle preserves scaffold, deletions, and both conventional commits", async () => {
  const { root, repo, tree, output, options } = fixture();
  writeFileSync(join(repo, "old.txt"), "scaffold");
  writeFileSync(join(repo, ".gitignore"), "ignored.txt\n");
  writeFileSync(join(repo, "ignored.txt"), "not committed");
  prepareRepository(repo, options);
  writeFileSync(join(tree, "new.txt"), "transformed");
  const result = finishRepository(repo, tree, options, output);
  expect(result.status).toBe("initialized");
  expect(git(repo, "log", "--format=%s").split("\n")).toEqual([
    INIT_COMMIT,
    INITIAL_COMMIT,
  ]);
  expect(git(repo, "show", `${result.base}:old.txt`)).toBe("scaffold");
  expect(git(repo, "ls-files")).toBe("new.txt");
  const delivered = join(root, "delivered");
  mkdirSync(delivered);
  git(
    delivered,
    "clone",
    "--branch",
    "main",
    join(output, "repository.bundle"),
    ".",
  );
  expect(git(delivered, "rev-parse", "main")).toBe(result.head);
  expect(git(delivered, "ls-files")).toBe("new.txt");
  const metadata: RepositoryResult = await Bun.file(
    join(output, "result.json"),
  ).json();
  expect(metadata.head).toBe(result.head);
});

test("update retains a two-parent merge and deterministic branch across retries", () => {
  const { root, repo, tree, output, options } = fixture();
  writeFileSync(join(repo, "file"), "before");
  prepareRepository(repo, options);
  const base = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(tree, "file"), "after");
  options.operation = "update";
  const result = finishRepository(repo, tree, options, output);
  expect(result.status).toBe("updated");
  const treeId = git(repo, "rev-parse", "HEAD^{tree}");
  expect(result.updateBranch).toBe(
    `drop-calf/update/${base.slice(0, 12)}-${treeId.slice(0, 12)}`,
  );
  expect(git(repo, "show", "-s", "--format=%P", "HEAD").split(" ")).toEqual([
    base,
    result.updateCommit ?? "",
  ]);
  // Retry from the same base with a retained update branch.
  git(repo, "reset", "--hard", base);
  const retried = finishRepository(repo, tree, options, join(root, "retry"));
  expect(retried.updateBranch).toBe(result.updateBranch);
  expect(retried.updateCommit).toBe(result.updateCommit);
  expect(retried.head).toBe(result.head);
  expect(finishRepository(repo, tree, options, join(root, "noop")).status).toBe(
    "unchanged",
  );
});

test("fresh init rejects potential credentials before recording any history", () => {
  const { repo, options } = fixture();
  writeFileSync(join(repo, ".env"), "TOKEN=secret");
  expect(() => prepareRepository(repo, options)).toThrow(
    "potential credentials",
  );
  expect(() => git(repo, "rev-parse", "--verify", "HEAD")).toThrow();
});

test("empty init creates a baseline and update without history is rejected", () => {
  const { repo, options } = fixture();
  expect(() =>
    prepareRepository(repo, { ...options, operation: "update" }),
  ).toThrow("requires repository history");
  prepareRepository(repo, options);
  expect(git(repo, "log", "--format=%s")).toBe(INITIAL_COMMIT);
});
