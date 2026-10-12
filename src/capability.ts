import type { Directory, Secret } from "@dagger.io/dagger";
import { type PackageContribution, updatePackage } from "./package-json.ts";
import type { ProjectBlueprint } from "./project.ts";

export type NoOp = { readonly reason: string };

/** An inactive verb is a decision, with a reason available to documentation. */
export function noOp(reason: string): NoOp {
  if (!reason.trim()) throw new Error("A no-op requires a non-empty reason");
  return Object.freeze({ reason });
}

export type Validation =
  | { status: "validated" }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

/** Run-scoped inputs every validator may read; capabilities ignore what they do not need. */
export type ValidationContext = {
  forgeEmail?: Secret;
  forgeApiToken?: Secret;
};

export type Capability = {
  name: string;
  /** Reference text lives with policy; inactive verbs use their NoOp reason instead. */
  documentation: {
    tools: { name: string; url: string; purpose: string }[];
    init?: string;
    update?: string;
    validate?: string;
  };
  /** Seed and policy for the shared package.json, applied by the package-json module. */
  packageJson?: PackageContribution;
  /** Verbs act on the files this capability owns; package.json is contributed instead. */
  init: ((project: ProjectBlueprint) => void) | NoOp;
  update: ((directory: Directory) => Directory | Promise<Directory>) | NoOp;
  validate:
    | ((
        directory: Directory,
        context?: ValidationContext,
      ) => Promise<Validation>)
    | NoOp;
  /** Optional CLI selection policy; omission makes the kind slot mandatory. */
  selection?: { with?: boolean; without?: boolean; default: boolean };
};

export function noOpReasons(capabilities: readonly Capability[]) {
  return capabilities.flatMap((capability) =>
    (["init", "update", "validate"] as const).flatMap((verb) => {
      const operation = capability[verb];
      return typeof operation === "function"
        ? []
        : [{ capability: capability.name, verb, reason: operation.reason }];
    }),
  );
}

export async function updateCapabilities(
  directory: Directory,
  capabilities: readonly Capability[],
): Promise<Directory> {
  // Package policy first, so verbs that read package.json see the result.
  let result = await updatePackage(directory, capabilities);
  for (const capability of capabilities) {
    if (typeof capability.update === "function")
      result = await capability.update(result);
  }
  return result;
}

/** Every check sees the same repository, and one failure does not hide other results. */
export async function validateCapabilities(
  directory: Directory,
  capabilities: readonly Capability[],
  context: ValidationContext = {},
): Promise<({ capability: string } & Validation)[]> {
  return Promise.all(
    capabilities.map(async (capability) => {
      let result: Validation;
      try {
        result =
          typeof capability.validate === "function"
            ? await capability.validate(directory, context)
            : { status: "skipped", reason: capability.validate.reason };
      } catch (error) {
        result = {
          status: "failed",
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      return { capability: capability.name, ...result };
    }),
  );
}
