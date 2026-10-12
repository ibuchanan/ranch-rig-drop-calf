import type { Directory } from "@dagger.io/dagger";

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
