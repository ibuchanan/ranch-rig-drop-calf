import { afterEach, expect, test } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  deliverRepository,
  inspectCheckout,
  sourceFingerprint,
} from "../scripts/repository.ts";
import {
  finishRepository,
  git,
  prepareRepository,
  type RepositoryOptions,
} from "../src/repository-git.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  mkdirSync(join(import.meta.dir, "../.scratch"), { recursive: true });
  const root = mkdtempSync(
    join(import.meta.dir, "../.scratch/tmp_rovo_delivery_"),
  );
  roots.push(root);
  const source = join(root, "source"),
    isolated = join(root, "isolated"),
    tree = join(root, "tree"),
    output = join(root, "output");
  for (const path of [source, isolated, tree]) mkdirSync(path);
  const options: RepositoryOptions = {
    operation: "init",
    branch: "main",
    authorName: "Test",
    authorEmail: "test@example.com",
  };
  return { root, source, isolated, tree, output, options };
}

test("deliver a fresh scaffold without replacing Git metadata or losing ignored files", () => {
  const { source, isolated, tree, output, options } = fixture();
  writeFileSync(join(source, "old.txt"), "scaffold");
  writeFileSync(join(source, ".gitignore"), ".env\n");
  writeFileSync(join(source, ".env"), "ignored secret");
  const fingerprint = sourceFingerprint(source);
  cpSync(source, isolated, { recursive: true });
  git(source, "init", "--initial-branch", "main", ".");
  prepareRepository(isolated, options);
  writeFileSync(join(tree, "new.txt"), "transformed");
  writeFileSync(join(tree, ".gitignore"), ".env\n");
  const result = finishRepository(isolated, tree, options, output);
  const delivered = deliverRepository(source, output, {
    branch: "main",
    fingerprint,
  });
  expect(delivered.head).toBe(result.head);
  expect(git(source, "status", "--porcelain")).toBe("");
  expect(git(source, "rev-list", "--count", "HEAD")).toBe("2");
  expect(readFileSync(join(source, ".env"), "utf8")).toBe("ignored secret");
  expect(existsSync(join(source, "old.txt"))).toBe(false);
});

test("deliver an update preserves config and retained branch and refuses concurrent edits", () => {
  const { root, source, isolated, tree, output, options } = fixture();
  writeFileSync(join(source, "file"), "before");
  prepareRepository(source, options);
  git(source, "config", "custom.setting", "preserve-me");
  const head = git(source, "rev-parse", "HEAD"),
    fingerprint = sourceFingerprint(source);
  const history = join(root, "input.bundle");
  git(source, "bundle", "create", history, "--all");
  options.operation = "update";
  prepareRepository(isolated, options, history);
  writeFileSync(join(tree, "file"), "after");
  const result = finishRepository(isolated, tree, options, output);
  writeFileSync(join(source, "file"), "concurrent edit");
  expect(() =>
    deliverRepository(source, output, { branch: "main", head, fingerprint }),
  ).toThrow();
  expect(git(source, "rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(join(source, "file"), "utf8")).toBe("concurrent edit");
  writeFileSync(join(source, "file"), "before");
  deliverRepository(source, output, { branch: "main", head, fingerprint });
  expect(git(source, "config", "custom.setting")).toBe("preserve-me");
  expect(git(source, "rev-parse", result.updateBranch ?? "")).toBe(
    result.updateCommit ?? "",
  );
  expect(
    git(source, "show", "-s", "--format=%P", "HEAD").split(" "),
  ).toHaveLength(2);
});

test("local preflight rejects parent repositories, dirty index, detached HEAD, and in-progress operations", () => {
  const { source, options } = fixture();
  prepareRepository(source, options);
  const child = join(source, "child");
  mkdirSync(child);
  expect(() => inspectCheckout(child)).toThrow("repository root");
  writeFileSync(join(source, "untracked"), "change");
  expect(() => inspectCheckout(source)).toThrow(
    "staged, unstaged, and untracked",
  );
  git(source, "add", "--all");
  expect(() => inspectCheckout(source)).toThrow();
  git(source, "commit", "-m", "chore: test");
  git(source, "switch", "--detach");
  expect(() => inspectCheckout(source)).toThrow("Detached HEAD");
  git(source, "switch", "main");
  writeFileSync(
    join(source, ".git/MERGE_HEAD"),
    git(source, "rev-parse", "HEAD"),
  );
  expect(() => inspectCheckout(source)).toThrow("operation in progress");
});
