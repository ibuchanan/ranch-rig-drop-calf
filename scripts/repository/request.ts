import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { enforce, type Guard } from "../../src/core/guards.ts";
import { scaffoldName } from "../../src/core/package-json.ts";
import { inspectCheckout } from "./checkout.ts";

const OPTIONS = {
  directory: { type: "string", default: "." },
  profile: { type: "string" },
  owner: { type: "string" },
  "package-name": { type: "string" },
  description: { type: "string" },
  preset: { type: "string" },
  "with-functions": { type: "string", multiple: true },
  "without-functions": { type: "string", multiple: true },
  "target-branch": { type: "string" },
  "author-name": { type: "string" },
  "author-email": { type: "string" },
  preview: { type: "boolean", default: false },
} as const;

const parse = (args: string[]) =>
  parseArgs({ args, allowPositionals: true, options: OPTIONS });
type Values = ReturnType<typeof parse>["values"];

type Operation = {
  /** Options that must be present for the invocation to be well formed. */
  required: readonly ("profile" | "owner")[];
  /** Options passed through to the Dagger call. */
  forwarded: readonly ("owner" | "package-name" | "description" | "preset")[];
  requiresCommit: boolean;
  /** Derive a package name from the scaffold when none is given. */
  seedsPackageName: boolean;
};

export const OPERATIONS = new Map<string, Operation>([
  [
    "init",
    {
      required: ["profile", "owner"],
      forwarded: ["owner", "package-name", "description", "preset"],
      requiresCommit: false,
      seedsPackageName: true,
    },
  ],
  [
    "update",
    {
      required: ["profile"],
      forwarded: ["preset"],
      requiresCommit: true,
      seedsPackageName: false,
    },
  ],
]);

const USAGE =
  "Usage: bun run scripts/repository.ts <init|update> --profile <kind> [--owner <id>] [--directory <root>] [--preview]";

export type Request = {
  operation: string;
  spec: Operation;
  values: Values;
  directory: string;
  original: ReturnType<typeof inspectCheckout>;
  branch: string;
  identity: { name: string; email: string };
};

const REQUEST_GUARDS: readonly Guard<Request>[] = [
  {
    fails: ({ spec, original }) => spec.requiresCommit && !original.head,
    message: "update requires an existing Git commit.",
  },
  {
    fails: ({ values, original }) =>
      Boolean(values["target-branch"] && original.branch) &&
      values["target-branch"] !== original.branch,
    message: "Target must match the checked-out branch.",
  },
  {
    fails: ({ identity }) => !identity.name || !identity.email,
    message:
      "Configure user.name/user.email or supply --author-name and --author-email.",
  },
];

/** Read the user's identity for input, but never copy their config/hooks into the container. */
function userConfig(directory: string, key: string): string {
  try {
    return execFileSync("git", ["-C", directory, "config", key], {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

export function resolveRequest(args: string[]): Request {
  const { values, positionals } = parse(args);
  const [operation = ""] = positionals;
  const spec = OPERATIONS.get(operation);
  if (
    !spec ||
    positionals.length !== 1 ||
    !spec.required.every((key) => values[key])
  )
    throw new Error(USAGE);
  const directory = realpathSync(resolve(values.directory));
  const original = inspectCheckout(directory);
  const request: Request = {
    operation,
    spec,
    values,
    directory,
    original,
    branch: original.branch ?? values["target-branch"] ?? "main",
    identity: {
      name: values["author-name"] ?? userConfig(directory, "user.name"),
      email: values["author-email"] ?? userConfig(directory, "user.email"),
    },
  };
  enforce(request, REQUEST_GUARDS);
  return request;
}

export type Workspace = {
  directory: string;
  snapshot: string;
  history: string;
  branch: string;
};

/** `--name value` pairs for an absent, single, or repeated option. */
const flags = (name: string, value: string | readonly string[] | undefined) =>
  [value ?? []].flat().flatMap((each) => [`--${name}`, each]);

function scaffoldPackageName(directory: string): string {
  const manifest = join(directory, "package.json");
  return (
    (existsSync(manifest)
      ? scaffoldName(readFileSync(manifest, "utf8"))
      : undefined) ?? basename(directory)
  );
}

export function daggerArguments(
  { operation, spec, values, directory, branch, identity }: Request,
  { snapshot }: Workspace,
  module: string,
  baselineFlags: string[],
  output: string,
): string[] {
  return [
    "-m",
    module,
    "call",
    operation,
    ...flags("directory", snapshot),
    ...flags("profile", values.profile),
    "--git",
    ...flags("target-branch", branch),
    ...flags("author-name", identity.name),
    ...flags("author-email", identity.email),
    ...baselineFlags,
    ...spec.forwarded.flatMap((key) => flags(key, values[key])),
    ...(spec.seedsPackageName && !values["package-name"]
      ? flags("package-name", scaffoldPackageName(directory))
      : []),
    ...flags("with-functions", values["with-functions"]),
    ...flags("without-functions", values["without-functions"]),
    "export",
    ...flags("path", output),
  ];
}
