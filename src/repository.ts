import { randomUUID } from "node:crypto";
import {
  type Directory,
  dag,
  type File,
  type Secret,
  type Socket,
} from "@dagger.io/dagger";
import type { RepositoryOptions } from "./repository-git.ts";
import { nodeContainer } from "./core/tool-run.ts";
import { TOOL_VERSIONS } from "./core/versions.ts";

export type RepositoryInput = RepositoryOptions & {
  directory: Directory;
  history?: File;
  authHeader?: Secret;
  sshAgent?: Socket;
  knownHosts?: File;
  publish: boolean;
};

/** Execute the same Git transaction for local bundle delivery and remote CI publication. */
export async function repositoryWorkflow(
  input: RepositoryInput,
  transform: (directory: Directory) => Promise<Directory>,
): Promise<Directory> {
  if (input.publish && (!input.remoteUrl || input.operation !== "update"))
    throw new Error("Publication requires update with a remote URL.");
  if (
    !input.history &&
    !input.remoteUrl &&
    (await input.directory.exists(".git"))
  )
    throw new Error(
      "Existing repositories require --history bundle; never copy .git.",
    );
  if (input.remoteUrl && input.history)
    throw new Error("Choose remote URL or local history, not both.");
  if (input.sshAgent && !input.knownHosts)
    throw new Error(
      "SSH requires a known-hosts file; host verification is never disabled.",
    );
  const {
    directory,
    history,
    authHeader,
    sshAgent,
    knownHosts,
    publish,
    ...options
  } = input;
  const script = dag.currentModule().source().file("src/repository-git.ts");
  let container = nodeContainer()
    .withFile(
      "/usr/local/bin/bun",
      dag
        .container()
        .from(`oven/bun:${TOOL_VERSIONS.bun}`)
        .file("/usr/local/bin/bun"),
    )
    .withFile("/workflow/git.ts", script)
    .withNewFile("/workflow/options.json", JSON.stringify(options))
    .withWorkdir("/repo");
  if (history)
    container = container.withFile("/workflow/input.bundle", history);
  else if (!input.remoteUrl)
    container = container.withDirectory("/repo", directory, {
      exclude: [".git", "**/.git", "node_modules", "**/node_modules"],
    });
  if (authHeader)
    container = container.withSecretVariable(
      "DROP_CALF_AUTH_HEADER",
      authHeader,
    );
  if (sshAgent)
    container = container
      .withUnixSocket("/workflow/ssh-agent", sshAgent)
      .withEnvVariable("SSH_AUTH_SOCK", "/workflow/ssh-agent");
  if (knownHosts)
    container = container.withFile("/root/.ssh/known_hosts", knownHosts);
  // Git fetch/push are external effects. A new invocation must never reuse their exec cache.
  container = container.withEnvVariable("DROP_CALF_INVOCATION", randomUUID());
  const args = ["bun", "run", "/workflow/git.ts"];
  container = container.withExec([
    ...args,
    "prepare",
    "/workflow/options.json",
    "/repo",
    "/output",
    ...(history ? ["/workflow/input.bundle"] : []),
  ]);
  await container.sync();
  const prepared = container;
  try {
    const before = container.directory("/repo").withoutDirectory(".git");
    const after = (await transform(before)).withoutDirectory(".git");
    container = container
      .withDirectory("/tree", after)
      .withExec([
        ...args,
        "finish",
        "/workflow/options.json",
        "/repo",
        "/output",
        "/tree",
      ]);
    await container.sync();
  } catch {
    // Preserve the baseline even when an immutable Dagger transformation/commit fails.
    return prepared
      .withExec([
        ...args,
        "recover",
        "/workflow/options.json",
        "/repo",
        "/output",
        "Transformation or commit failed; inspect Dagger logs for details.",
      ])
      .directory("/output");
  }
  if (publish) {
    const committed = container;
    try {
      container = container.withExec([
        ...args,
        "publish",
        "/workflow/options.json",
        "/repo",
        "/output",
      ]);
      await container.sync();
    } catch {
      return committed
        .withExec([
          ...args,
          "publication-failed",
          "/workflow/options.json",
          "/repo",
          "/output",
        ])
        .directory("/output");
    }
  }
  return container.directory("/output");
}
