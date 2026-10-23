/** Kinds that run on Bun: package scripts, hooks, and compiler types follow it. */
const BUN_KINDS = ["tool", "agent-skill"];

export function isBunKind(kind: string): boolean {
  return BUN_KINDS.includes(kind);
}
