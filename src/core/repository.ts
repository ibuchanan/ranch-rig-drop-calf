import { randomUUID } from "node:crypto";
import {
  type Container,
  type Directory,
  dag,
  type File,
  type Secret,
  type Socket,
} from "@dagger.io/dagger";
import { enforce, type Guard } from "./guards.ts";
import type { RepositoryOptions } from "./repository-git.ts";
import { nodeContainer } from "./tool-run.ts";
import { TOOL_VERSIONS } from "./versions.ts";

export type RepositoryInput = RepositoryOptions & {
  directory: Directory;
  history?: File;
  authHeader?: Secret;
  sshAgent?: Socket;
  knownHosts?: File;
  publish: boolean;
};

type Preflight = { input: RepositoryInput; hasGit: boolean };

const PREFLIGHT: readonly Guard<Preflight>[] = [
  {
    fails: ({ input }) =>
      input.publish && (!input.remoteUrl || input.operation !== "update"),
    message: "Publication requires update with a remote URL.",
  },
  {
    fails: ({ hasGit }) => hasGit,
    message: "Existing repositories require --history bundle; never copy .git.",
  },
  {
    fails: ({ input }) => Boolean(input.remoteUrl && input.history),
    message: "Choose remote URL or local history, not both.",
  },
  {
    fails: ({ input }) => Boolean(input.sshAgent && !input.knownHosts),
    message:
      "SSH requires a known-hosts file; host verification is never disabled.",
  },
];

type Step = (container: Container) => Container;

/** Applies `apply` with the value when one was supplied, and leaves the container alone otherwise. */
const given =
  <T>(
    value: T | undefined,
    apply: (value: T, container: Container) => Container,
  ): Step =>
  (container) =>
    value === undefined ? container : apply(value, container);

/** A Git workflow stage, run by the bun script that Drop Calf mounts into the container. */
const gitStage = (stage: string, ...extra: string[]) => [
  "bun",
  "run",
  "/workflow/git.ts",
  stage,
  "/workflow/options.json",
  "/repo",
  "/output",
  ...extra,
];

/** A stage that may fail, and how to preserve the last good state if it does. */
type Stage = {
  run: (container: Container) => Promise<Container>;
  recover: Step;
};

/** Run a stage and wait for it, so its failure surfaces here and not later. */
async function settle(container: Container): Promise<Container> {
  await container.sync();
  return container;
}

/** Execute the same Git transaction for local bundle delivery and remote CI publication. */
export async function repositoryWorkflow(
  input: RepositoryInput,
  transform: (directory: Directory) => Promise<Directory>,
): Promise<Directory> {
  const hasGit =
    !input.history &&
    !input.remoteUrl &&
    (await input.directory.exists(".git"));
  enforce({ input, hasGit }, PREFLIGHT);
  const {
    directory,
    history,
    authHeader,
    sshAgent,
    knownHosts,
    publish,
    ...options
  } = input;
  const helper = (path: string) => dag.currentModule().source().file(path);
  const script = helper("src/core/repository-git.ts");
  const base = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withFile("/workflow/git.ts", script)
    // git.ts imports its helpers by relative path, so they sit beside it.
    .withFile("/workflow/guards.ts", helper("src/core/guards.ts"))
    .withNewFile("/workflow/options.json", JSON.stringify(options))
    .withWorkdir("/repo");
  // What this invocation brings into the container, each applied only when supplied.
  const contributions: Step[] = [
    given(history, (file, c) => c.withFile("/workflow/input.bundle", file)),
    given(!history && !options.remoteUrl ? directory : undefined, (source, c) =>
      c.withDirectory("/repo", source, {
        exclude: [".git", "**/.git", "node_modules", "**/node_modules"],
      }),
    ),
    given(authHeader, (secret, c) =>
      c.withSecretVariable("DROP_CALF_AUTH_HEADER", secret),
    ),
    given(sshAgent, (socket, c) =>
      c
        .withUnixSocket("/workflow/ssh-agent", socket)
        .withEnvVariable("SSH_AUTH_SOCK", "/workflow/ssh-agent"),
    ),
    given(knownHosts, (file, c) => c.withFile("/root/.ssh/known_hosts", file)),
    // Git fetch/push are external effects. A new invocation must never reuse their exec cache.
    (c) => c.withEnvVariable("DROP_CALF_INVOCATION", randomUUID()),
  ];
  const configured = contributions.reduce((c, apply) => apply(c), base);
  const prepared = await settle(
    configured.withExec(
      gitStage("prepare", ...(history ? ["/workflow/input.bundle"] : [])),
    ),
  );
  const stages: Stage[] = [
    {
      run: async (container) => {
        const before = container.directory("/repo").withoutDirectory(".git");
        const after = (await transform(before)).withoutDirectory(".git");
        return settle(
          container
            .withDirectory("/tree", after)
            .withExec(gitStage("finish", "/tree")),
        );
      },
      // Preserve the baseline even when an immutable Dagger transformation/commit fails.
      recover: (container) =>
        container.withExec(
          gitStage(
            "recover",
            "Transformation or commit failed; inspect Dagger logs for details.",
          ),
        ),
    },
    ...(publish
      ? [
          {
            run: (container: Container) =>
              settle(container.withExec(gitStage("publish"))),
            recover: (container: Container) =>
              container.withExec(gitStage("publication-failed")),
          },
        ]
      : []),
  ];
  let container = prepared;
  for (const stage of stages) {
    try {
      container = await stage.run(container);
    } catch {
      return stage.recover(container).directory("/output");
    }
  }
  return container.directory("/output");
}
