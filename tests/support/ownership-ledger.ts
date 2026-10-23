import { type Directory, dag, type File } from "@dagger.io/dagger";
import type { Capability } from "../../src/core/capability.ts";
import { seedPackage } from "../../src/core/package-json.ts";
import {
  createBlueprint,
  type ProjectBlueprint,
} from "../../src/core/project.ts";
import { seedTemplates } from "../../src/core/templates.ts";
import { mockDirectory } from "./module-source.ts";

type MockDirectory = ReturnType<typeof mockDirectory>;

/** Package sections whose entries are owned one key at a time. */
const PACKAGE_SECTIONS = [
  "scripts",
  "dependencies",
  "devDependencies",
] as const;

/** Flatten a package.json into one output per section entry or top-level field. */
export const packageOutputs = (
  pkg: Record<string, unknown>,
): Map<string, unknown> => {
  const outputs = new Map<string, unknown>();
  for (const [key, value] of Object.entries(pkg)) {
    if ((PACKAGE_SECTIONS as readonly string[]).includes(key)) {
      for (const [name, entry] of Object.entries(
        value as Record<string, unknown>,
      ))
        outputs.set(`package.json#${key}.${name}`, entry);
    } else outputs.set(`package.json#${key}`, value);
  }
  return outputs;
};

/** `Directory` writes that claim an output, and how each reports what it wrote. */
const DIRECTORY_WRITES: Record<
  string,
  (
    ledger: OwnershipLedger,
    target: MockDirectory,
  ) => (...args: never[]) => Directory
> = {
  withNewFile:
    (ledger, target) =>
    (path: string, contents: string, options?: { permissions?: number }) => {
      if (path === "package.json")
        ledger.claimPackageChange(target.files.get(path) ?? "{}", contents);
      else ledger.claim(path);
      return ledger.trackDirectory(target.withNewFile(path, contents, options));
    },
  withDirectory:
    (ledger, target) =>
    (path: string, source: Directory & { files: Map<string, string> }) => {
      for (const written of source.files.keys()) ledger.claim(written);
      return ledger.trackDirectory(target.withDirectory(path, source));
    },
  withFile: (ledger, target) => (path: string, file: File) => {
    ledger.claim(path);
    return ledger.trackDirectory(target.withFile(path, file));
  },
  withoutFile: (ledger, target) => (path: string) => {
    ledger.claim(path);
    return ledger.trackDirectory(target.withoutFile(path));
  },
};

/** Methods are bound to the real target so internal state is not proxied. */
const bound = (target: object, key: string | symbol) => {
  const entry = Reflect.get(target, key, target);
  return typeof entry === "function" ? entry.bind(target) : entry;
};

/**
 * Records which capability writes each output, including same-value writes,
 * so the tests can assert that every file and package entry has one owner.
 */
class OwnershipLedger {
  readonly owners = new Map<string, Set<string>>();
  /** The capability currently acting; every claim is attributed to it. */
  actor = "";

  claim(output: string): void {
    const claimed = this.owners.get(output) ?? new Set<string>();
    claimed.add(this.actor);
    this.owners.set(output, claimed);
  }

  /** Claim each package output whose value differs between two package.json texts. */
  claimPackageChange(before: string, after: string): void {
    const was = packageOutputs(JSON.parse(before));
    const now = packageOutputs(JSON.parse(after));
    for (const name of new Set([...was.keys(), ...now.keys()]))
      if (JSON.stringify(was.get(name)) !== JSON.stringify(now.get(name)))
        this.claim(name);
  }

  /** Claim every output a capability declares in its package contribution. */
  claimDeclared({ packageJson }: Capability): void {
    const { seed, policy, remove } = packageJson ?? {};
    for (const fields of [seed, policy])
      for (const name of packageOutputs(fields ?? {}).keys()) this.claim(name);
    for (const field of remove ?? []) this.claim(`package.json#${field}`);
  }

  trackPackage<T extends object>(value: T, prefix = ""): T {
    return new Proxy(value, {
      get: (target, key, receiver) => {
        const entry = Reflect.get(target, key, receiver);
        return typeof key === "string" &&
          (PACKAGE_SECTIONS as readonly string[]).includes(key) &&
          entry
          ? this.trackPackage(entry, `${key}.`)
          : entry;
      },
      set: (target, key, entry, receiver) => {
        if (typeof key === "string")
          for (const output of this.setOutputs(prefix, key, entry))
            this.claim(output);
        return Reflect.set(target, key, entry, receiver);
      },
    });
  }

  /** What assigning `entry` to `key` writes: a section's entries, or the one field. */
  private setOutputs(prefix: string, key: string, entry: object): string[] {
    return (PACKAGE_SECTIONS as readonly string[]).includes(key)
      ? Object.keys(entry).map((name) => `package.json#${key}.${name}`)
      : [`package.json#${prefix}${key}`];
  }

  trackFiles(files: Map<string, string>): Map<string, string> {
    return new Proxy(files, {
      get: (target, key) =>
        key === "set"
          ? (path: string, contents: string) => {
              this.claim(path);
              target.set(path, contents);
              return files;
            }
          : bound(target, key),
    });
  }

  trackDirectory(directory: Directory): Directory {
    return new Proxy(directory as MockDirectory, {
      get: (target, key) =>
        typeof key === "string" && Object.hasOwn(DIRECTORY_WRITES, key)
          ? DIRECTORY_WRITES[key]?.(this, target)
          : bound(target, key),
    }) as Directory;
  }

  /** A blueprint whose package and file writes are claimed by the acting capability. */
  trackedBlueprint(): ProjectBlueprint {
    const project = createBlueprint("sample", "A sample project", "tester");
    project.packageJson = this.trackPackage(project.packageJson);
    project.files = this.trackFiles(project.files);
    return project;
  }
}

/** Files a kind's scaffolder supplies before Drop Calf runs. */
const SCAFFOLD_FILES: Record<string, [string, string][]> = {
  "forge-app": [
    ["manifest.yml", "app:\n  id: example\n  runtime:\n    name: nodejs20.x\n"],
  ],
};

/** Package identity that catalog-derived updates must overwrite. */
const STALE_IDENTITY = {
  name: "old",
  author: "old",
  description: "old",
  type: "commonjs",
};

type PackageSections = Partial<
  Record<(typeof PACKAGE_SECTIONS)[number], Record<string, string>>
>;

/** Owner-edited values every updater must see, so none can hide behind another's write. */
function ownerEditedPackage(
  pkg: Record<string, unknown> & PackageSections,
): Record<string, unknown> {
  const stale = structuredClone(pkg);
  for (const section of PACKAGE_SECTIONS)
    for (const key of Object.keys(stale[section] ?? {}))
      (stale[section] as Record<string, string>)[key] = "owner";
  return {
    ...stale,
    private: false,
    license: "owner",
    engines: { node: "owner" },
  };
}

/** Record actual writes, including same-value init assignments; never copy ownership declarations. */
export async function outputOwners(capabilities: Capability[], kind: string) {
  const ledger = new OwnershipLedger();
  const project = ledger.trackedBlueprint();
  for (const capability of capabilities) {
    ledger.actor = capability.name;
    // Declared contributions are claims, recorded even when assembly would reject them.
    ledger.claimDeclared(capability);
    if (typeof capability.init === "function") capability.init(project);
  }
  // Assemble outside the tracking proxy; a collision is already recorded above.
  const pkg = JSON.parse(JSON.stringify(project.packageJson));
  try {
    seedPackage(pkg, capabilities);
  } catch {
    // Reported through the owners map instead.
  }
  // Start from intentionally stale package identity to observe catalog-derived ownership.
  let directory = ledger.trackDirectory(
    mockDirectory(
      new Map([
        ["package.json", JSON.stringify({ ...pkg, ...STALE_IDENTITY })],
        ...project.files,
        ...(SCAFFOLD_FILES[kind] ?? []),
      ]),
    ),
  );
  for (const capability of capabilities) {
    ledger.actor = capability.name;
    const contribution = createBlueprint(
      "sample",
      "A sample project",
      "tester",
    );
    if (typeof capability.init === "function") capability.init(contribution);
    directory = await seedTemplates(
      directory,
      dag.currentModule().source(),
      contribution.templates,
    );
  }
  const stale = ownerEditedPackage(
    JSON.parse(await directory.file("package.json").contents()),
  );
  const input = mockDirectory(
    new Map((directory as MockDirectory).files),
  ).withNewFile("package.json", JSON.stringify(stale));
  // Each updater sees the same stale input so a previous updater cannot hide
  // a second owner by already setting an identical value.
  for (const capability of capabilities) {
    ledger.actor = capability.name;
    if (typeof capability.update === "function")
      await capability.update(ledger.trackDirectory(input));
  }
  return { owners: ledger.owners, directory };
}
