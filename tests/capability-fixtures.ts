import type { Directory } from "@dagger.io/dagger";
import {
  type Capability,
  type NoOp,
  updateCapabilities,
} from "../src/capability.ts";
import { seedPackage } from "../src/package-json.ts";
import type { ProjectBlueprint } from "../src/project.ts";

export const kinds = ["library", "forge-app", "tool", "agent-skill"];

/** The optional-function selections each kind must satisfy. */
export const selections = (kind: string) => [
  { withFunctions: [], withoutFunctions: [], preset: undefined },
  { withFunctions: [], withoutFunctions: [], preset: "all" },
  ...(kind === "forge-app"
    ? [
        { withFunctions: ["evals"], withoutFunctions: [], preset: undefined },
        { withFunctions: [], withoutFunctions: ["evals"], preset: "all" },
        { withFunctions: [], withoutFunctions: ["aidev"], preset: "all" },
      ]
    : []),
];

/** Sorted file entries of an in-memory mock directory. */
export const contents = (directory: Directory) =>
  [...(directory as unknown as { files: Map<string, string> }).files].sort(
    ([a], [b]) => a.localeCompare(b),
  );

/** Init one capability as buildProject does: its package contribution, then its verb. */
export function runInit(capability: Capability, project: ProjectBlueprint) {
  seedPackage(project.packageJson, [capability]);
  if (typeof capability.init === "function") capability.init(project);
}

/**
 * A capability's own active verb, without the composition that reports throws as
 * `failed`. Use it to assert a verb's direct outcome, including its errors.
 */
export function verb<Name extends "update" | "validate">(
  capability: Capability,
  name: Name,
): Exclude<Capability[Name], NoOp> {
  const operation = capability[name];
  if (typeof operation !== "function")
    throw new Error(
      `${capability.name} ${name} is a no-op: ${operation.reason}`,
    );
  return operation as Exclude<Capability[Name], NoOp>;
}

/** Update one capability as DropCalf does: its package policy, then its verb. */
export const runUpdate = (capability: Capability, directory: Directory) =>
  updateCapabilities(directory, [capability]);
