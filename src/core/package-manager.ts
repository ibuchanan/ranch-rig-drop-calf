/** The package manager a project kind runs its scripts with; each kind implies exactly one. */
export type PackageManager = "npm" | "bun";

export type PackageManagerOption = { packageManager?: PackageManager };

export const runScript = (manager: PackageManager, script: string) =>
  `${manager} run ${script}`;

/** Shipped templates are written for npm; this is the one place they are translated. */
export function forPackageManager(
  text: string,
  manager: PackageManager,
): string {
  return manager === "npm"
    ? text
    : text
        .replaceAll(/npm run (\S+) --if-present/g, "bun run --if-present $1")
        .replaceAll("npm install", "bun install")
        .replaceAll("npm run", "bun run");
}
