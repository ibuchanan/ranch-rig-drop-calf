import { buildProject, InvalidOptionsError } from "./profiles.ts";
import { createBlueprint } from "./project.ts";
import { mergeTypeScriptConfig } from "./typescript-config.ts";

export type SyncOperation = {
  path: string;
  key: string;
  mode:
    | "structured-merge"
    | "line-set"
    | "section-map"
    | "managed-region"
    | "create-if-absent";
  before: string | undefined;
  after: string;
};

export class ConflictError extends Error {
  constructor(
    section: string,
    key: string,
    found: unknown,
    wanted: string,
    path = "package.json",
  ) {
    super(
      `sync: ${path} ${section}.${key}: found ${JSON.stringify(found)}, wanted ${JSON.stringify(wanted)}; resolve the conflict before syncing.`,
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
  ignoreSets: string[];
  files: Map<string, string>;
  operations: SyncOperation[];
};

export function planSync(
  files: ReadonlyMap<string, string>,
  profile: string,
  ignoreSets: string[] = ["node", "build", "coverage", "logs", "env", "editor"],
): SyncPlan {
  const allowed = ["node", "build", "coverage", "logs", "env", "editor"];
  for (const set of ignoreSets)
    if (!allowed.includes(set))
      throw new InvalidOptionsError(
        `Unknown ignore set ${JSON.stringify(set)}; choose ${allowed.join(", ")}.`,
      );
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
    for (const section of [
      "scripts",
      "devDependencies",
      "dependencies",
      "engines",
    ] as const) {
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
  const desiredProject = buildProject(
    profile,
    current.name,
    typeof current.description === "string" ? current.description : "",
    typeof current.license === "string" ? current.license : "none",
    typeof current.author === "string" ? current.author : "",
  );
  const desired = desiredProject.packageJson;
  const operations: SyncOperation[] = [];
  const nodePin = desiredProject.files.get(".nvmrc");
  if (
    nodePin !== undefined &&
    files.has(".nvmrc") &&
    files.get(".nvmrc")?.trim() !== nodePin.trim()
  )
    throw new ConflictError(
      "node",
      "major",
      files.get(".nvmrc"),
      nodePin.trim(),
      ".nvmrc",
    );
  if (nodePin !== undefined && !files.has(".nvmrc"))
    operations.push({
      path: ".nvmrc",
      key: "node",
      mode: "create-if-absent",
      before: undefined,
      after: nodePin,
    });
  for (const path of [
    "LICENSE",
    "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md",
    "DEVELOPMENT.md",
    ".atlassian/OWNER",
    "README.md",
    "AGENTS.md",
    "cliff.toml",
    ...(profile === "forge-app"
      ? ["secretspec.toml", "scripts/forge-vars-from-secretspec.sh"]
      : []),
  ]) {
    const after = desiredProject.files.get(path);
    if (after !== undefined && !files.has(path))
      operations.push({
        path,
        key: "seed",
        mode: "create-if-absent",
        before: undefined,
        after,
      });
  }
  const guidance = desiredProject.files.get("AGENTS.md");
  if (
    guidance !== undefined &&
    files.has("AGENTS.md") &&
    files.get("AGENTS.md") !== guidance
  )
    throw new ConflictError(
      "guidance",
      "content",
      files.get("AGENTS.md"),
      guidance,
      "AGENTS.md",
    );
  const engines = (current.engines ?? {}) as Record<string, unknown>;
  if (engines.node !== undefined && engines.node !== desired.engines.node)
    throw new ConflictError(
      "engines",
      "node",
      engines.node,
      desired.engines.node,
    );
  if (engines.node === undefined)
    operations.push({
      path: "package.json",
      key: "engines.node",
      mode: "structured-merge",
      before: undefined,
      after: desired.engines.node,
    });
  for (const section of [
    "scripts",
    "devDependencies",
    "dependencies",
  ] as const) {
    const values = (current[section] ?? {}) as Record<string, unknown>;
    for (const [key, after] of Object.entries(desired[section] ?? {})) {
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
  if (profile === "library") {
    for (const key of ["main", "types", "exports"] as const) {
      const after = desired[key];
      const before = current[key];
      if (
        before !== undefined &&
        JSON.stringify(before) !== JSON.stringify(after)
      )
        throw new ConflictError(
          "publishing",
          key,
          before,
          JSON.stringify(after),
          "package.json",
        );
      if (before === undefined && after !== undefined)
        operations.push({
          path: "package.json",
          key,
          mode: "structured-merge",
          before: undefined,
          after: typeof after === "string" ? after : JSON.stringify(after),
        });
    }
  }
  const biome = desiredProject.files.get("biome.json");
  if (biome !== undefined) {
    const before = files.get("biome.json");
    const after =
      before === undefined ? biome : mergeBiomeConfig(before, biome);
    if (before !== after)
      operations.push({
        path: "biome.json",
        key: "config",
        mode: before === undefined ? "create-if-absent" : "structured-merge",
        before,
        after,
      });
  }
  for (const path of ["tsconfig.json", "tsconfig.typecheck.json"] as const) {
    const template = desiredProject.files.get(path);
    if (template === undefined) continue;
    const before = files.get(path);
    const after =
      before === undefined
        ? template
        : mergeTypeScriptConfig(path, before, template);
    if (after !== before)
      operations.push({
        path,
        key: "config",
        mode: before === undefined ? "create-if-absent" : "structured-merge",
        before,
        after,
      });
  }
  const tsdown = desiredProject.files.get("tsdown.config.ts");
  if (tsdown !== undefined) {
    const before = files.get("tsdown.config.ts");
    if (before !== undefined && before !== tsdown)
      throw new ConflictError(
        "config",
        "content",
        before,
        tsdown,
        "tsdown.config.ts",
      );
    if (before === undefined)
      operations.push({
        path: "tsdown.config.ts",
        key: "config",
        mode: "create-if-absent",
        before,
        after: tsdown,
      });
  }
  const allRules =
    createBlueprint(current.name, "", "none", "").files.get(".gitignore") ?? "";
  const groups = allRules.split(/(?=^# )/m).filter(Boolean);
  const headings: Record<string, string> = {
    dependencies: "node",
    "build output": "build",
    "test coverage": "coverage",
    logs: "logs",
    environment: "env",
    "editor and OS": "editor",
  };
  const rules = groups
    .filter((group) =>
      ignoreSets.includes(headings[group.split("\n")[0]?.slice(2) ?? ""] ?? ""),
    )
    .join("");
  const existing = files.get(".gitignore") ?? "";
  const present = new Set(existing.split(/\r?\n/).map((line) => line.trim()));
  const additions = rules
    .split("\n")
    .filter((line) => line && !line.startsWith("#") && !present.has(line));
  if (additions.length)
    operations.push({
      path: ".gitignore",
      key: "rules",
      mode: "line-set",
      before: files.get(".gitignore"),
      after: `${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${additions.join("\n")}\n`,
    });
  const editorTemplate =
    createBlueprint(current.name, "", "none", "").files.get(".editorconfig") ??
    "";
  const editor = files.get(".editorconfig") ?? "";
  const mergedEditor = mergeEditorconfig(editor, editorTemplate);
  if (mergedEditor !== editor)
    operations.push({
      path: ".editorconfig",
      key: "sections",
      mode: "section-map",
      before: files.get(".editorconfig"),
      after: mergedEditor,
    });
  const readme = files.get("README.md");
  if (readme !== undefined) {
    const start = "<!-- drop-calf:usage start -->";
    const end = "<!-- drop-calf:usage end -->";
    const starts = readme.split(start).length - 1;
    const ends = readme.split(end).length - 1;
    if (
      starts !== ends ||
      starts > 1 ||
      (starts === 1 && readme.indexOf(end) < readme.indexOf(start))
    )
      throw new ParseError(
        "README.md",
        "unmatched or duplicate drop-calf:usage markers",
      );
    if (starts === 1) {
      const wanted =
        createBlueprint(current.name, "", "none", "").files.get("README.md") ??
        "";
      const region = wanted.slice(
        wanted.indexOf(start),
        wanted.indexOf(end) + end.length,
      );
      const after =
        readme.slice(0, readme.indexOf(start)) +
        region +
        readme.slice(readme.indexOf(end) + end.length);
      if (after !== readme)
        operations.push({
          path: "README.md",
          key: "usage",
          mode: "managed-region",
          before: readme,
          after,
        });
    }
  }
  return { profile, ignoreSets, files: new Map(files), operations };
}

function mergeBiomeConfig(existing: string, template: string): string {
  let current: Record<string, unknown>;
  try {
    current = JSON.parse(existing);
    if (
      current === null ||
      typeof current !== "object" ||
      Array.isArray(current)
    )
      throw new Error("expected an object");
  } catch (error) {
    throw new ParseError("biome.json", String(error));
  }
  const required = JSON.parse(template) as Record<string, unknown>;
  let changed = false;
  const isObject = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === "object" && !Array.isArray(value);
  const merge = (
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    prefix = "",
  ) => {
    for (const [key, wanted] of Object.entries(source)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const found = target[key];
      if (found === undefined) {
        target[key] = wanted;
        changed = true;
      } else if (isObject(wanted) && isObject(found)) {
        merge(found, wanted, path);
      } else if (JSON.stringify(found) !== JSON.stringify(wanted)) {
        throw new ConflictError(
          "config",
          path,
          found,
          JSON.stringify(wanted),
          "biome.json",
        );
      }
    }
  };
  merge(current, required);
  return changed ? `${JSON.stringify(current, null, 2)}\n` : existing;
}

function mergeEditorconfig(existing: string, template: string): string {
  const lines = existing.split(/\r?\n/);
  const sections = new Map<string, { end: number; keys: Set<string> }>();
  let section = "";
  sections.set(section, { end: 0, keys: new Set() });
  for (const [index, line] of lines.entries()) {
    const value = line.trim();
    if (value.startsWith("[")) {
      if (!/^\[[^\]]+\]$/.test(value))
        throw new ParseError(
          ".editorconfig",
          `invalid section ${JSON.stringify(line)}`,
        );
      if (sections.has(value))
        throw new ParseError(".editorconfig", `duplicate section ${value}`);
      const previous = sections.get(section);
      if (previous) previous.end = index;
      section = value;
      sections.set(section, { end: lines.length, keys: new Set() });
    } else if (value && !value.startsWith("#") && !value.startsWith(";")) {
      const match = /^([^=]+?)\s*=\s*(.*)$/.exec(value);
      if (!match?.[1]?.trim() || !match[2]?.trim())
        throw new ParseError(
          ".editorconfig",
          `invalid entry ${JSON.stringify(line)}`,
        );
      const key = match[1].trim();
      const keys = sections.get(section)?.keys;
      if (keys?.has(key))
        throw new ParseError(".editorconfig", `duplicate ${section} ${key}`);
      keys?.add(key);
    }
  }
  const additions = new Map<string, string[]>();
  section = "";
  for (const line of template.split("\n")) {
    if (line.startsWith("[")) section = line;
    else if (line.includes(" = ")) {
      const key = line.split(" = ")[0] ?? "";
      if (!sections.get(section)?.keys.has(key)) {
        const values = additions.get(section) ?? [];
        values.push(line);
        additions.set(section, values);
      }
    }
  }
  if (!additions.size) return existing;
  const inserted = [...lines];
  for (const [name, { end }] of [...sections].reverse()) {
    const values = additions.get(name);
    if (values) inserted.splice(end, 0, ...values);
    additions.delete(name);
  }
  for (const [name, values] of additions) inserted.push("", name, ...values);
  return `${inserted.join("\n").replace(/\n*$/, "")}\n`;
}

export function applySync(plan: SyncPlan): {
  files: Map<string, string>;
  journal: { outcome: "validated"; operations: number };
} {
  const files = new Map(plan.files);
  const raw = files.get("package.json");
  if (raw === undefined) throw new ValidationError("is missing");
  const pkg = JSON.parse(raw);
  let packageChanged = false;
  for (const { path, key, after } of plan.operations) {
    if (path !== "package.json") {
      files.set(path, after);
      continue;
    }
    packageChanged = true;
    const dot = key.indexOf(".");
    if (dot === -1) {
      pkg[key] = key === "exports" ? JSON.parse(after) : after;
      continue;
    }
    const section = key.slice(0, dot);
    const name = key.slice(dot + 1);
    pkg[section] ??= {};
    pkg[section][name] = after;
  }
  if (plan.operations.length === 0)
    return { files, journal: { outcome: "validated", operations: 0 } };
  if (packageChanged)
    files.set("package.json", `${JSON.stringify(pkg, null, 2)}\n`);
  try {
    if (planSync(files, plan.profile, plan.ignoreSets).operations.length !== 0)
      throw new Error("owned keys did not converge");
  } catch (error) {
    throw new ValidationError(`did not converge: ${String(error)}`);
  }
  return {
    files,
    journal: { outcome: "validated", operations: plan.operations.length },
  };
}
