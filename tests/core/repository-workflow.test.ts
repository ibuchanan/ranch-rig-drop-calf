import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Container, type Directory, dag } from "@dagger.io/dagger";
import {
  type RepositoryInput,
  repositoryWorkflow,
} from "../../src/core/repository.ts";

/** What the fake container recorded: its operations in order, and the directory it exported. */
type Exported = { ops: string[]; path: string };

/** An exported directory; stripping `.git` leaves it identifiable. */
function fakeDirectory(ops: string[], path: string) {
  const self: Exported & { withoutDirectory: () => Exported } = {
    ops,
    path,
    withoutDirectory: () => self,
  };
  return self;
}

/** An immutable, recording stand-in for a Dagger container. */
function fakeContainer(ops: string[], failing: ReadonlySet<string>) {
  const next = (op: string) => fakeContainer([...ops, op], failing);
  return {
    ops,
    from: (image: string) => next(`from ${image}`),
    file: (path: string) => `file ${path}`,
    withFile: (path: string) => next(`withFile ${path}`),
    withNewFile: (path: string) => next(`withNewFile ${path}`),
    withWorkdir: (path: string) => next(`workdir ${path}`),
    withDirectory: (
      path: string,
      _source: unknown,
      options?: { exclude: string[] },
    ) =>
      next(
        `withDirectory ${path}${options ? ` exclude=${options.exclude.join(",")}` : ""}`,
      ),
    withSecretVariable: (name: string) => next(`secret ${name}`),
    withUnixSocket: (path: string) => next(`socket ${path}`),
    withEnvVariable: (name: string) => next(`env ${name}`),
    // args: bun run /workflow/repository-git.ts <stage> options repo output ...extra
    withExec: (args: string[]) =>
      next(["exec", args[3], ...args.slice(7)].join(" ")),
    sync: async () => {
      const last = ops.at(-1) ?? "";
      if (failing.has(last)) throw new Error(`${last} failed`);
    },
    directory: (path: string) => fakeDirectory(ops, path),
  };
}

const ENDPOINT = "https://example.com/repo.git";

let failing: Set<string>;
let restore: (() => void)[];

beforeEach(() => {
  failing = new Set();
  restore = [];
  const root = fakeContainer([], failing);
  const stubs = [
    spyOn(dag, "container").mockReturnValue(root as unknown as Container),
    spyOn(dag, "currentModule").mockReturnValue({
      source: () => ({ file: () => "script" }),
    } as never),
  ];
  restore = stubs.map((stub) => () => stub.mockRestore());
});
afterEach(() => {
  for (const undo of restore) undo();
});

const input = (overrides: Partial<RepositoryInput> = {}): RepositoryInput => ({
  operation: "update",
  branch: "main",
  authorName: "Ada",
  authorEmail: "ada@example.com",
  directory: { exists: async () => false } as unknown as Directory,
  publish: false,
  ...overrides,
});

const history = {} as RepositoryInput["history"];

const run = async (
  repository: RepositoryInput,
  transform: (directory: Directory) => Promise<Directory> = async (d) => d,
) => (await repositoryWorkflow(repository, transform)) as unknown as Exported;

const execs = (exported: Exported) =>
  exported.ops.filter((op) => op.startsWith("exec "));

test("local history prepares, finishes, and exports /output without copying the source", async () => {
  const exported = await run(input({ history }));
  expect(exported.path).toBe("/output");
  expect(execs(exported)).toEqual([
    "exec prepare /workflow/input.bundle",
    "exec finish /tree",
  ]);
  expect(exported.ops).toContain("withFile /workflow/input.bundle");
  expect(exported.ops.some((op) => op.startsWith("withDirectory /repo"))).toBe(
    false,
  );
  expect(exported.ops).toContain("env DROP_CALF_INVOCATION");
});

test("a fresh scaffold is copied into /repo without Git metadata or dependency trees", async () => {
  const exported = await run(input());
  expect(exported.ops).toContain(
    "withDirectory /repo exclude=.git,**/.git,node_modules,**/node_modules",
  );
  expect(execs(exported)).toEqual(["exec prepare", "exec finish /tree"]);
});

test("a remote checkout brings in no local directory or bundle", async () => {
  const exported = await run(input({ remoteUrl: ENDPOINT }));
  expect(exported.ops.some((op) => op.startsWith("withDirectory /repo"))).toBe(
    false,
  );
  expect(
    exported.ops.some((op) => op.startsWith("withFile /workflow/input")),
  ).toBe(false);
});

test("credentials and SSH are mounted only when supplied", async () => {
  const bare = await run(input({ remoteUrl: ENDPOINT }));
  expect(bare.ops.some((op) => /^(secret|socket|env SSH)/.test(op))).toBe(
    false,
  );
  const full = await run(
    input({
      remoteUrl: ENDPOINT,
      authHeader: {} as RepositoryInput["authHeader"],
      sshAgent: {} as RepositoryInput["sshAgent"],
      knownHosts: {} as RepositoryInput["knownHosts"],
    }),
  );
  expect(full.ops).toEqual(
    expect.arrayContaining([
      "secret DROP_CALF_AUTH_HEADER",
      "socket /workflow/ssh-agent",
      "env SSH_AUTH_SOCK",
      "withFile /root/.ssh/known_hosts",
    ]),
  );
});

test("a failing transformation exports a recovery bundle from the prepared baseline", async () => {
  const exported = await run(input({ history }), async () => {
    throw new Error("transform broke");
  });
  expect(execs(exported)).toEqual([
    "exec prepare /workflow/input.bundle",
    "exec recover Transformation or commit failed; inspect Dagger logs for details.",
  ]);
});

test("a failing finish stage also recovers from the prepared baseline", async () => {
  failing.add("exec finish /tree");
  const exported = await run(input({ history }));
  expect(execs(exported).map((op) => op.split(" ")[1])).toEqual([
    "prepare",
    "recover",
  ]);
});

test("publication runs after finish when requested", async () => {
  const exported = await run(
    input({ history: undefined, remoteUrl: ENDPOINT, publish: true }),
  );
  expect(execs(exported).map((op) => op.split(" ")[1])).toEqual([
    "prepare",
    "finish",
    "publish",
  ]);
});

test("a failed publication keeps the committed result and records the failure", async () => {
  failing.add("exec publish");
  const exported = await run(input({ remoteUrl: ENDPOINT, publish: true }));
  expect(execs(exported).map((op) => op.split(" ")[1])).toEqual([
    "prepare",
    "finish",
    "publication-failed",
  ]);
});

test("a failing prepare stage rejects instead of recovering", async () => {
  failing.add("exec prepare /workflow/input.bundle");
  await expect(run(input({ history }))).rejects.toThrow("prepare");
});

test.each([
  [
    "publication without a remote",
    { publish: true },
    "Publication requires update with a remote URL.",
  ],
  [
    "publication of init",
    { publish: true, remoteUrl: ENDPOINT, operation: "init" as const },
    "Publication requires update with a remote URL.",
  ],
  [
    "both remote and history",
    { remoteUrl: ENDPOINT, history },
    "Choose remote URL or local history, not both.",
  ],
  [
    "SSH without known hosts",
    { remoteUrl: ENDPOINT, sshAgent: {} as RepositoryInput["sshAgent"] },
    "SSH requires a known-hosts file; host verification is never disabled.",
  ],
])("preflight rejects %s", async (_name, overrides, message) => {
  await expect(run(input(overrides))).rejects.toThrow(message);
});

test("an existing .git requires a history bundle", async () => {
  const withGit = input({
    directory: { exists: async () => true } as unknown as Directory,
  });
  await expect(run(withGit)).rejects.toThrow(
    "Existing repositories require --history bundle; never copy .git.",
  );
  // A bundle or remote makes the directory's own .git irrelevant.
  await expect(run({ ...withGit, history })).resolves.toBeDefined();
});

test("every relative import of the mounted git script is mounted beside it", async () => {
  // The container receives repository-git.ts alone as /workflow/repository-git.ts, so an
  // import such as "./guards.ts" resolves only if that file is mounted too.
  const script = readFileSync(
    join(import.meta.dir, "../../src/core/repository-git.ts"),
    "utf8",
  );
  const helpers = [...script.matchAll(/from "\.\/([^"]+)"/g)].map(
    ([, name]) => name,
  );
  expect(helpers.length).toBeGreaterThan(0);
  const exported = await run(input({ history }));
  for (const name of helpers)
    expect(exported.ops).toContain(`withFile /workflow/${name}`);
});
