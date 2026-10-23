import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  finishRepository,
  git,
  prepareRepository,
  publishRepository,
} from "../../src/core/repository-git.ts";
import { repositoryWorkspaces } from "../support/repository-fixtures.ts";

const workspace = repositoryWorkspaces();
function fixture() {
  const { root, options } = workspace();
  const source = join(root, "source"),
    remote = join(root, "remote.git"),
    isolated = join(root, "isolated"),
    tree = join(root, "tree"),
    output = join(root, "output");
  for (const path of [source, remote, isolated, tree]) mkdirSync(path);
  writeFileSync(join(source, "file"), "before");
  prepareRepository(source, options);
  git(remote, "init", "--bare", ".");
  git(source, "push", remote, "main");
  const history = join(root, "input.bundle");
  git(source, "bundle", "create", history, "--branches");
  options.operation = "update";
  prepareRepository(isolated, options, history);
  options.remoteUrl = remote;
  writeFileSync(join(tree, "file"), "after");
  const result = finishRepository(isolated, tree, options, output);
  return { root, source, remote, isolated, tree, output, options, result };
}

test("publication retains update branch and pushes the exact merge without force", () => {
  const { remote, isolated, options, result } = fixture();
  expect(publishRepository(isolated, options, result).published).toBe(true);
  expect(git(remote, "rev-parse", "main")).toBe(result.head);
  expect(git(remote, "rev-parse", result.updateBranch ?? "")).toBe(
    result.updateCommit ?? "",
  );
  expect(git(remote, "show", "-s", "--format=%P", "main").split(" ")).toEqual([
    result.base,
    result.updateCommit ?? "",
  ]);
});

test("publication recovery preserves a usable bundle and valid failure metadata", async () => {
  const { root, isolated, output, options, result } = fixture();
  const config = join(root, "options.json");
  writeFileSync(config, JSON.stringify(options));
  execFileSync("bun", [
    "run",
    join(import.meta.dir, "../../src/core/repository-git.ts"),
    "publication-failed",
    config,
    isolated,
    output,
  ]);
  const recovered = await Bun.file(join(output, "result.json")).json();
  expect(recovered.status).toBe("failed");
  expect(recovered.head).toBe(result.head);
  expect(recovered.updateBranch).toBe(result.updateBranch);
  git(isolated, "bundle", "verify", join(output, "repository.bundle"));
});

test("target advance refuses publication but retains a recovery branch", () => {
  const { source, remote, isolated, options, result } = fixture();
  writeFileSync(join(source, "concurrent"), "someone else");
  git(source, "add", "--all");
  git(source, "commit", "-m", "feat: concurrent change");
  const advanced = git(source, "rev-parse", "HEAD");
  git(source, "push", remote, "main");
  expect(() => publishRepository(isolated, options, result)).toThrow(
    "changed; update branch retained",
  );
  expect(git(remote, "rev-parse", "main")).toBe(advanced);
  expect(git(remote, "rev-parse", result.updateBranch ?? "")).toBe(
    result.updateCommit ?? "",
  );
});

test("remote collision is never overwritten", () => {
  const { source, remote, isolated, options, result } = fixture();
  git(source, "push", remote, `main:refs/heads/${result.updateBranch}`);
  // An existing ancestor can be fast-forwarded safely; a divergent branch cannot.
  git(source, "switch", "--create", "collision");
  writeFileSync(join(source, "unrelated"), "different");
  git(source, "add", "--all");
  git(source, "commit", "-m", "chore: different work");
  git(source, "push", remote, `HEAD:refs/heads/${result.updateBranch}`);
  const collision = git(remote, "rev-parse", result.updateBranch ?? "");
  expect(() => publishRepository(isolated, options, result)).toThrow();
  expect(git(remote, "rev-parse", result.updateBranch ?? "")).toBe(collision);
  expect(git(remote, "rev-parse", "main")).toBe(result.base);
});
