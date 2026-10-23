import { execFileSync } from "node:child_process";

/** Git runs with isolated configuration, without repository hooks or interactive prompts. */
export function git(directory: string, ...args: string[]): string {
  return execFileSync(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "tag.gpgSign=false",
      "-C",
      directory,
      ...args,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

export function optionalGit(
  directory: string,
  ...args: string[]
): string | undefined {
  try {
    return git(directory, ...args);
  } catch {
    return undefined;
  }
}
