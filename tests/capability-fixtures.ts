import type { Directory } from "@dagger.io/dagger";
import {
  type Capability,
  type NoOp,
  updateCapabilities,
} from "../src/capability.ts";
import { seedPackage } from "../src/package-json.ts";
import { PROFILES } from "../src/profiles.ts";
import type { ProjectBlueprint } from "../src/project.ts";

export const kinds = ["library", "forge-app", "tool", "agent-skill"];

/** The optional-function selections each kind must satisfy. */
export const selections = (kind: string) => [
  { withFunctions: [], withoutFunctions: [], preset: undefined },
  { withFunctions: [], withoutFunctions: [], preset: "all" },
  ...(["library", "tool"].includes(kind)
    ? [{ withFunctions: [], withoutFunctions: ["fallow"], preset: undefined }]
    : []),
  ...(kind === "forge-app"
    ? [
        { withFunctions: ["evals"], withoutFunctions: [], preset: undefined },
        { withFunctions: [], withoutFunctions: ["evals"], preset: "all" },
        { withFunctions: [], withoutFunctions: ["aidev"], preset: "all" },
      ]
    : []),
];

/** A kind's own configured capability, so tests exercise the policy options it declares. */
export function capabilityOf(kind: string, name: string): Capability {
  const capability = PROFILES[kind]?.find((item) => item.name === name);
  if (!capability) throw new Error(`${kind} has no ${name} capability`);
  return capability;
}

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
