import type { Directory } from "@dagger.io/dagger";
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

export type Capability = {
  name: string;
  init: ((project: ProjectBlueprint) => void) | NoOp;
  update: ((directory: Directory) => Directory | Promise<Directory>) | NoOp;
  validate: ((directory: Directory) => Promise<Validation>) | NoOp;
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
  let result = directory;
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
): Promise<({ capability: string } & Validation)[]> {
  return Promise.all(
    capabilities.map(async (capability) => {
      let result: Validation;
      try {
        result =
          typeof capability.validate === "function"
            ? await capability.validate(directory)
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
