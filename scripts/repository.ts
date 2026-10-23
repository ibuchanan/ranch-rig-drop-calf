import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { git } from "../src/core/git.ts";
import { checkStagedFiles } from "../src/core/repository-policy.ts";
import { SKIPPED_ENTRIES, sourceFingerprint } from "./repository/checkout.ts";
import { deliverRepository } from "./repository/delivery.ts";
import {
  daggerArguments,
  type Request,
  resolveRequest,
  type Workspace,
} from "./repository/request.ts";

/** Captures the source for the container and returns any Dagger flags it needs. */
type Baseline = (workspace: Workspace) => string[];

const BASELINES: Record<"committed" | "unborn", Baseline> = {
  committed({ directory, history }) {
    git(directory, "bundle", "create", history, "--branches", "--tags");
    return ["--history", history];
  },
  unborn({ directory, snapshot, branch }) {
    cpSync(directory, snapshot, {
      recursive: true,
      filter: (path) =>
        path === directory || !SKIPPED_ENTRIES.includes(basename(path)),
    });
    // Preflight a fresh scaffold's staged paths without changing the source index.
    git(snapshot, "init", "--initial-branch", branch, ".");
    git(snapshot, "add", "--all");
    checkStagedFiles(snapshot);
    rmSync(join(snapshot, ".git"), { recursive: true });
    return [];
  },
};

type Run = {
  request: Request;
  workspace: Workspace;
  module: string;
  output: string;
  fingerprint: string;
};

/** Run the Dagger call, then deliver its bundle into the checkout unless previewing. */
function generateAndDeliver({
  request,
  workspace,
  module,
  output,
  fingerprint,
}: Run): string {
  const { values, directory, original, branch } = request;
  const baselineFlags =
    BASELINES[original.head ? "committed" : "unborn"](workspace);
  execFileSync(
    "dagger",
    daggerArguments(request, workspace, module, baselineFlags, output),
    { cwd: module, stdio: "inherit" },
  );
  if (values.preview) return `Preview artifacts: ${output}`;
  const result = deliverRepository(directory, output, {
    branch,
    head: original.head,
    fingerprint,
  });
  return `${result.status}: ${result.head}${result.updateBranch ? ` (${result.updateBranch})` : ""}`;
}

async function main(args: string[]): Promise<void> {
  const request = resolveRequest(args);
  const { values, directory, branch } = request;
  const module = resolve(import.meta.dir, "..");
  mkdirSync(join(module, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(module, ".scratch/tmp_rovo_local_"));
  const workspace: Workspace = {
    directory,
    snapshot: join(root, "input"),
    history: join(root, "input.bundle"),
    branch,
  };
  mkdirSync(workspace.snapshot);
  try {
    console.log(
      generateAndDeliver({
        request,
        workspace,
        module,
        output: join(root, "output"),
        fingerprint: sourceFingerprint(directory),
      }),
    );
    if (!values.preview) rmSync(root, { recursive: true, force: true });
  } catch (error) {
    console.error(`Recovery files retained at ${root}`);
    throw error;
  }
}

if (import.meta.main) await main(process.argv.slice(2));
