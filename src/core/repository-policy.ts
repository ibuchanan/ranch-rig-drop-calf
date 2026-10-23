import { git } from "./git.ts";
import type { RepositoryOptions } from "./repository-types.ts";

/** Why a remote URL is unacceptable, or undefined when it is fine. */
function remoteProblem(url: string): string | undefined {
  if (url.startsWith("https://") || url.startsWith("ssh://")) {
    const { password, protocol, username, search, hash } = new URL(url);
    return password || (protocol === "https:" && username) || search || hash
      ? "Remote URL must not contain credentials, query parameters, or fragments."
      : undefined;
  }
  return /^git@[^:/]+:.+/.test(url)
    ? undefined
    : "Remote URL must use credential-free HTTPS or SSH.";
}

/** Reject identities and remotes that could leak credentials or corrupt commits. */
export function checkOptions({
  authorName,
  authorEmail,
  remoteUrl,
}: RepositoryOptions): void {
  if (
    !authorName.trim() ||
    !authorEmail.trim() ||
    /[\r\n\0]/.test(authorName + authorEmail)
  )
    throw new Error(
      "Git author name and email must be nonblank single-line values.",
    );
  const problem = remoteUrl ? remoteProblem(remoteUrl) : undefined;
  if (problem) throw new Error(problem);
}

/** Refuse common credential files even if an incomplete scaffold ignore file misses them. */
export function checkStagedFiles(directory: string): void {
  const paths = git(
    directory,
    "diff",
    "--cached",
    "--name-only",
    "--diff-filter=ACMR",
    "-z",
  ).split("\0");
  const suspicious = paths.filter(
    (path) =>
      /(^|\/)(\.env(?:\..+)?|\.npmrc|\.netrc|credentials(?:\.json)?|id_(?:rsa|ed25519)|[^/]+\.(?:pem|key|p12|pfx))$/.test(
        path,
      ) && !/(^|\/)\.env\.(?:example|sample|template)$/.test(path),
  );
  // A generated .npmrc is ordinary configuration; authentication directives are not.
  const unsafe = suspicious.filter(
    (path) =>
      !path.endsWith(".npmrc") ||
      /(?:_auth|password|token)\s*=/i.test(git(directory, "show", `:${path}`)),
  );
  if (unsafe.length)
    throw new Error(
      `Refusing to commit potential credentials: ${unsafe.join(", ")}. Ignore or remove them first.`,
    );
}
