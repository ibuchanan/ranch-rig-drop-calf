// One table over every capability's declared package.json contribution, so the
// shared seed/policy/remove semantics are proven once per declaration instead of
// restated in each capability's own suite. Behavior a verb adds beyond its
// contribution (catalog-derived fields, file outputs) stays with that capability.
import { expect, spyOn, test } from "bun:test";
import type { Directory } from "@dagger.io/dagger";
import { PROFILES } from "../../src/composition/profiles.ts";
import type { Capability } from "../../src/core/capability.ts";
import {
  type PackageFields,
  seedPackage,
  updatePackage,
} from "../../src/core/package-json.ts";
import { runUpdate as runVerbs } from "../support/capability-fixtures.ts";
import { mockDirectory, mockModuleSource } from "../support/module-source.ts";

/** Package policy then the capability's own verb, with the module's real templates. */
async function runUpdate(capability: Capability, directory: Directory) {
  const source = mockModuleSource();
  try {
    return await runVerbs(capability, directory);
  } finally {
    source.mockRestore();
  }
}

const SECTIONS = ["scripts", "dependencies", "devDependencies"] as const;

/** Each distinct contribution once, labelled by capability and the kinds that use it. */
const contributors = (() => {
  const unique = new Map<string, { capability: Capability; kinds: string[] }>();
  for (const [kind, capabilities] of Object.entries(PROFILES))
    for (const capability of capabilities) {
      if (!capability.packageJson) continue;
      const key = `${capability.name} ${JSON.stringify(capability.packageJson)}`;
      const entry = unique.get(key) ?? { capability, kinds: [] };
      entry.kinds.push(kind);
      unique.set(key, entry);
    }
  return [...unique.values()].map(({ capability, kinds }) => ({
    label: `${capability.name} (${kinds.join(", ")})`,
    capability,
  }));
})();

const fieldsOf = (fields: PackageFields | undefined) => fields ?? {};
const isSection = (field: string) =>
  (SECTIONS as readonly string[]).includes(field);

/** The package an owner who deleted every contributed key would get back from update. */
function restored(capability: Capability, owner: Record<string, unknown>) {
  const { policy, remove = [] } = capability.packageJson ?? {};
  const expected: Record<string, unknown> = structuredClone(owner);
  for (const [field, value] of Object.entries(fieldsOf(policy)))
    expected[field] = isSection(field)
      ? { ...(expected[field] as object), ...(value as object) }
      : value;
  for (const field of remove) delete expected[field];
  return expected;
}

/** Section entries either lifecycle declares, with the value update would enforce for each. */
function sectionEntries(
  seed: PackageFields | undefined,
  policy: PackageFields | undefined,
): [section: string, entry: string, wanted: unknown][] {
  const enforced = fieldsOf(policy);
  return [fieldsOf(seed), enforced].flatMap((fields) =>
    Object.entries(fields)
      .filter(([field]) => isSection(field))
      .flatMap(([field, value]) =>
        Object.entries(value as object).map(
          ([entry, version]): [string, string, unknown] => [
            field,
            entry,
            (enforced[field] as Record<string, unknown> | undefined)?.[entry] ??
              version,
          ],
        ),
      ),
  );
}

const read = async (directory: Directory) =>
  JSON.parse(await directory.file("package.json").contents());

const withPackage = (text: string) =>
  mockDirectory(new Map([["package.json", text]]));

test("every contributing capability is covered", () => {
  expect(contributors.length).toBeGreaterThan(10);
});

test.each(contributors)(
  "$label init writes every seed and policy entry, minus removals",
  ({ capability }) => {
    const { seed, policy, remove = [] } = capability.packageJson ?? {};
    const pkg: Record<string, unknown> = { [remove[0] ?? "unused"]: "owner" };
    seedPackage(pkg, [capability]);
    for (const [section, entry, wanted] of sectionEntries(seed, policy))
      expect(pkg[section]).toHaveProperty([entry], wanted);
    for (const [field, value] of Object.entries(fieldsOf(policy)))
      if (!isSection(field)) expect(pkg[field]).toEqual(value);
    for (const field of remove) expect(pkg).not.toHaveProperty(field);
  },
);

test.each(contributors)(
  "$label update leaves a missing package.json missing",
  async ({ capability }) => {
    const empty = mockDirectory();
    expect(await updatePackage(empty, [capability])).toBe(empty);
    const output = await runUpdate(capability, empty);
    expect(await output.exists("package.json")).toBe(false);
  },
);

test.each(contributors)(
  "$label update restores policy around owner values and never re-adds seeds",
  async ({ capability }) => {
    const owner = {
      name: "owner",
      custom: { keep: true },
      scripts: { "owner:task": "owner" },
      devDependencies: { "owner-tool": "1.0.0" },
    };
    const output = await updatePackage(withPackage(JSON.stringify(owner)), [
      capability,
    ]);
    expect(await read(output)).toEqual(restored(capability, owner));
    expect(await updatePackage(output, [capability])).toBe(output);
  },
);

test.each(contributors)(
  "$label update keeps the bytes of a package that already matches",
  async ({ capability }) => {
    const pkg: Record<string, unknown> = { name: "owner" };
    seedPackage(pkg, [capability]);
    const text = `${JSON.stringify(pkg, null, 4).replaceAll("\n", "\r\n")}`;
    const input = withPackage(text);
    expect(await updatePackage(input, [capability])).toBe(input);
    expect(await input.file("package.json").contents()).toBe(text);
  },
);

const malformedRoots = ["{", "null", "[]", '"bad"', "1"];
const malformedSections = (field: string) =>
  ["null", "[]", '"bad"', "1", "true"].map((value) => `{"${field}":${value}}`);

test.each(contributors)(
  "$label update rejects unsafe package input before writing",
  async ({ capability }) => {
    const { seed, policy } = capability.packageJson ?? {};
    const sections = Object.keys({ ...fieldsOf(seed), ...fieldsOf(policy) })
      .filter(isSection)
      .filter((field) => field in fieldsOf(policy) || field !== "scripts");
    for (const text of [
      ...malformedRoots,
      ...sections.flatMap(malformedSections),
    ]) {
      const input = withPackage(text);
      const write = spyOn(input, "withNewFile");
      try {
        await expect(runUpdate(capability, input)).rejects.toThrow(
          "package.json",
        );
        expect(write).not.toHaveBeenCalled();
        expect(await input.file("package.json").contents()).toBe(text);
      } finally {
        write.mockRestore();
      }
    }
  },
);
