import { buildProject } from "./profiles.ts";

export type SyncOperation = {
  path: "package.json";
  key: string;
  mode: "structured-merge";
  before: string | undefined;
  after: string;
};

export class ConflictError extends Error {
  constructor(section: string, key: string, found: unknown, wanted: string) {
    super(
      `sync: package.json ${section}.${key}: found ${JSON.stringify(found)}, wanted ${JSON.stringify(wanted)}; resolve the conflict before syncing.`,
    );
    this.name = "ConflictError";
  }
}

export class ParseError extends Error {
  constructor(path: string, reason: string) {
    super(
      `sync: cannot parse ${path}: ${reason}; fix the file before syncing.`,
    );
    this.name = "ParseError";
  }
}

export class ValidationError extends Error {
  constructor(reason: string) {
    super(`sync: package.json ${reason}; fix the package before syncing.`);
    this.name = "ValidationError";
  }
}

export type SyncPlan = {
  profile: string;
  files: Map<string, string>;
  operations: SyncOperation[];
};

export function planSync(
  files: ReadonlyMap<string, string>,
  profile: string,
): SyncPlan {
  const raw = files.get("package.json");
  if (raw === undefined) throw new ValidationError("is missing");
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(raw);
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    )
      throw new Error("expected an object");
    for (const section of ["scripts", "devDependencies"] as const) {
      const value = current[section];
      if (
        value !== undefined &&
        (value === null || typeof value !== "object" || Array.isArray(value))
      )
        throw new Error(`expected ${section} to be an object`);
    }
  } catch (error) {
    throw new ParseError("package.json", String(error));
  }
  if (typeof current.name !== "string" || !current.name.trim())
    throw new ValidationError("name must be a non-empty string");
  const desired = buildProject(profile, current.name).packageJson;
  const operations: SyncOperation[] = [];
  for (const section of ["scripts", "devDependencies"] as const) {
    const values = (current[section] ?? {}) as Record<string, unknown>;
    for (const [key, after] of Object.entries(desired[section])) {
      const before = Object.hasOwn(values, key) ? values[key] : undefined;
      if (before !== undefined && before !== after)
        throw new ConflictError(section, key, before, after);
      if (before !== after)
        operations.push({
          path: "package.json",
          key: `${section}.${key}`,
          mode: "structured-merge",
          before: undefined,
          after,
        });
    }
  }
  return { profile, files: new Map(files), operations };
}

export function applySync(plan: SyncPlan): {
  files: Map<string, string>;
  journal: { outcome: "validated"; operations: number };
} {
  const files = new Map(plan.files);
  const raw = files.get("package.json");
  if (raw === undefined) throw new ValidationError("is missing");
  const pkg = JSON.parse(raw);
  for (const { key, after } of plan.operations) {
    const dot = key.indexOf(".");
    const section = key.slice(0, dot);
    const name = key.slice(dot + 1);
    pkg[section] ??= {};
    pkg[section][name] = after;
  }
  if (plan.operations.length === 0)
    return { files, journal: { outcome: "validated", operations: 0 } };
  files.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  try {
    if (planSync(files, plan.profile).operations.length !== 0)
      throw new Error("owned keys did not converge");
  } catch (error) {
    throw new ValidationError(`did not converge: ${String(error)}`);
  }
  return {
    files,
    journal: { outcome: "validated", operations: plan.operations.length },
  };
}
