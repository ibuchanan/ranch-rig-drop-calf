import { describe, expect, test } from "bun:test";
import type { Directory, File } from "@dagger.io/dagger";
import {
  ADDITIONAL_IGNORES,
  availableSets,
  buildGitignore,
  copyGitignoreAssets,
  GITIGNORE_QUERY,
  GITIGNORE_TEMPLATES,
  normalizeSet,
  PINNED_GITIGNORE,
  parseTemplate,
  readPinnedTemplate,
} from "../src/gitignore.ts";
import { InvalidOptionsError } from "../src/profiles.ts";
import { pinnedGitignore } from "./module-source.ts";

const template = pinnedGitignore();

/** Minimal stand-ins for the Dagger handles `copyGitignoreAssets` consumes. */
const fakeDirectory = (writes: Map<string, string>) =>
  ({
    withNewFile: (path: string, contents: string) => {
      writes.set(path, contents);
      return fakeDirectory(writes);
    },
  }) as unknown as Directory;

const fakeFile = (contents: string) =>
  ({ contents: async () => contents }) as unknown as File;

test("the pinned artifact records the templates it was fetched from", () => {
  expect(PINNED_GITIGNORE).toBe("vendor/gitignore");
  expect(GITIGNORE_QUERY).toBe(GITIGNORE_TEMPLATES.join(","));
  expect(template).toContain(`# Created by `);
  expect(template).toContain(GITIGNORE_QUERY);
  expect(template.endsWith("\n")).toBe(true);
});

test("the pinned artifact preserves the CR-sensitive macOS icon rule", () => {
  // gitignore.io emits `Icon\r\r`; an editor or fetch that normalises line
  // endings silently breaks the rule, so pin it byte-exact.
  expect(template).toContain("\nIcon\r\r\n");
});

test("every default template resolves to a section in the pin", () => {
  const known = availableSets(template);
  for (const name of GITIGNORE_TEMPLATES)
    expect(known).toContain(name.toLowerCase());
});

describe("normalizeSet", () => {
  test("folds case and the gitignore.io Patch suffix onto the set name", () => {
    expect(normalizeSet("Node")).toBe("node");
    expect(normalizeSet("Node Patch")).toBe("node");
    expect(normalizeSet("macOS Patch")).toBe("macos");
    expect(normalizeSet("VisualStudioCode")).toBe("visualstudiocode");
  });
});

describe("parseTemplate", () => {
  test("keeps the provenance header and drops the end marker", () => {
    const { provenance } = parseTemplate(template);
    expect(provenance).toHaveLength(2);
    expect(provenance[0]).toStartWith("# Created by ");
    expect(provenance[1]).toStartWith("# Edit at ");
    expect(template).toContain("# End of ");
  });
});

describe("buildGitignore", () => {
  const built = buildGitignore(template);

  test("keeps provenance, sections, and the personal defaults", () => {
    expect(built).toStartWith("# Created by ");
    expect(built).toContain("### Node ###");
    expect(built).toContain("### VisualStudioCode ###");
    expect(built.endsWith(ADDITIONAL_IGNORES)).toBe(true);
  });

  test("drops the trailing end marker", () => {
    expect(built).not.toContain("# End of ");
  });

  test("appends the extras after a blank line", () => {
    expect(built).toContain(`\n\n# Additional ignores\n`);
    expect(built).toContain("/.cocoindex_code/");
  });

  test("de-duplicates rules on first occurrence", () => {
    const rules = built
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
    expect(rules.length).toBe(new Set(rules).size);
  });

  test("selects only the requested sections", () => {
    const nodeOnly = buildGitignore(template, ["node"]);
    expect(nodeOnly).toContain("### Node ###");
    expect(nodeOnly).toContain("node_modules/");
    expect(nodeOnly).not.toContain("### macOS ###");
    expect(nodeOnly).not.toContain(".DS_Store");
    expect(nodeOnly).not.toContain("Thumbs.db");
    expect(nodeOnly).not.toContain("!.vscode/settings.json");
  });

  test("keeps the extras regardless of the selected sets", () => {
    expect(buildGitignore(template, ["node"])).toContain("/.cocoindex_code/");
  });

  test("rejects an unknown set and lists what the pin can satisfy", () => {
    expect(() => buildGitignore(template, ["nope"])).toThrow(
      InvalidOptionsError,
    );
    expect(() => buildGitignore(template, ["nope"])).toThrow(/choose from/);
    expect(buildGitignore(template, [])).toContain(ADDITIONAL_IGNORES);
  });

  test("ends with exactly one newline", () => {
    expect(built.endsWith("\n")).toBe(true);
    expect(built.endsWith("\n\n")).toBe(false);
  });
});

describe("readPinnedTemplate", () => {
  test("returns the pinned bytes when the source is a real template", async () => {
    expect(await readPinnedTemplate(fakeFile(template))).toBe(template);
  });

  test("rejects a source with no sections rather than emitting bare extras", async () => {
    await expect(readPinnedTemplate(fakeFile(""))).rejects.toThrow(
      /missing or malformed/,
    );
    await expect(
      readPinnedTemplate(fakeFile("# Created by somewhere\n")),
    ).rejects.toThrow(/refresh:gitignore/);
  });
});

describe("copyGitignoreAssets", () => {
  test("writes a generated .gitignore into the supplied directory", async () => {
    const writes = new Map<string, string>();
    await copyGitignoreAssets(fakeDirectory(writes), fakeFile(template));
    expect(writes.get(".gitignore")).toBe(buildGitignore(template));
  });

  test("defaults to every pinned template and honours an explicit subset", async () => {
    const all = new Map<string, string>();
    await copyGitignoreAssets(fakeDirectory(all), fakeFile(template));
    const subset = new Map<string, string>();
    await copyGitignoreAssets(fakeDirectory(subset), fakeFile(template), [
      "node",
    ]);
    expect(subset.get(".gitignore")).toBe(buildGitignore(template, ["node"]));
    expect(subset.get(".gitignore")).not.toBe(all.get(".gitignore"));
    expect(subset.get(".gitignore")).not.toContain("### macOS ###");
  });

  test("rejects an unknown set before touching the directory", async () => {
    const writes = new Map<string, string>();
    await expect(
      copyGitignoreAssets(fakeDirectory(writes), fakeFile(template), ["nope"]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(writes.size).toBe(0);
  });

  test("propagates a missing pin instead of writing a partial file", async () => {
    const writes = new Map<string, string>();
    await expect(
      copyGitignoreAssets(fakeDirectory(writes), fakeFile("")),
    ).rejects.toThrow(/missing or malformed/);
    expect(writes.size).toBe(0);
  });
});
