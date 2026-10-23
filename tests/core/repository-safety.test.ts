import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  deliverRepository,
  inspectCheckout,
  sourceFingerprint,
} from "../../scripts/repository.ts";
import {
  finishRepository,
  git,
  prepareRepository,
} from "../../src/core/repository-git.ts";
import { repositoryWorkspaces } from "../support/repository-fixtures.ts";

const workspace = repositoryWorkspaces();
function fixture() {
  const { root, options } = workspace();
  const repo = join(root, "repo"),
    tree = join(root, "tree"),
    output = join(root, "output");
  for (const path of [repo, tree]) mkdirSync(path);
  return { root, repo, tree, output, options };
}

test("no-op initialization still exports and delivers the baseline", () => {
  const { root, repo, tree, output, options } = fixture();
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "init", "--initial-branch", "main", ".");
  const fingerprint = sourceFingerprint(source);
  prepareRepository(repo, options);
  const result = finishRepository(repo, tree, options, output);
  expect(result.status).toBe("initialized");
  deliverRepository(source, output, { branch: "main", fingerprint });
  expect(git(source, "rev-list", "--count", "HEAD")).toBe("1");
});

test("unborn staged content is rejected instead of replacing its index", () => {
  const { repo } = fixture();
  git(repo, "init", "--initial-branch", "main", ".");
  writeFileSync(join(repo, "file"), "staged version");
  git(repo, "add", "file");
  writeFileSync(join(repo, "file"), "working version");
  expect(() => inspectCheckout(repo)).toThrow(
    "Unborn repository has staged changes",
  );
  expect(git(repo, "show", ":file")).toBe("staged version");
  expect(readFileSync(join(repo, "file"), "utf8")).toBe("working version");
});

test("local delivery never overwrites ignored data introduced by generated files", () => {
  const { root, repo, tree, output, options } = fixture();
  writeFileSync(join(repo, ".gitignore"), "local-data\n");
  prepareRepository(repo, options);
  const source = join(root, "source");
  mkdirSync(source);
  git(source, "clone", "--branch", "main", repo, ".");
  writeFileSync(join(source, "local-data"), "owner data");
  const head = git(source, "rev-parse", "HEAD"),
    fingerprint = sourceFingerprint(source);
  // Removing the ignore makes local-data a tracked generated file.
  writeFileSync(join(tree, "local-data"), "generated data");
  options.operation = "update";
  finishRepository(repo, tree, options, output);
  expect(() =>
    deliverRepository(source, output, { branch: "main", head, fingerprint }),
  ).toThrow();
  expect(readFileSync(join(source, "local-data"), "utf8")).toBe("owner data");
  expect(git(source, "rev-parse", "HEAD")).toBe(head);
});

test.each([
  "https://user:secret@example.com/repo.git",
  "https://example.com/repo.git?token=secret",
  "ssh://git:secret@example.com/repo.git",
  "/some/local/path",
])("unsafe remote URL is rejected: %s", (remoteUrl) => {
  const { repo, options } = fixture();
  expect(() => prepareRepository(repo, { ...options, remoteUrl })).toThrow();
});

test("init refuses existing markers before committing a baseline", () => {
  const { repo, options } = fixture();
  writeFileSync(join(repo, "catalog-info.yaml"), "existing");
  expect(() => prepareRepository(repo, options)).toThrow("one-time operation");
  expect(() => git(repo, "rev-parse", "--verify", "HEAD")).toThrow();
});

test("a mismatched deterministic branch is rejected rather than reset", () => {
  const { repo, tree, output, options } = fixture();
  writeFileSync(join(repo, "file"), "before");
  prepareRepository(repo, options);
  const base = git(repo, "rev-parse", "HEAD");
  writeFileSync(join(tree, "file"), "after");
  options.operation = "update";
  const result = finishRepository(repo, tree, options, output);
  git(repo, "reset", "--hard", base);
  git(repo, "branch", "--force", result.updateBranch ?? "", base);
  expect(() => finishRepository(repo, tree, options, output)).toThrow(
    "Update branch collision",
  );
  expect(git(repo, "rev-parse", result.updateBranch ?? "")).toBe(base);
});
