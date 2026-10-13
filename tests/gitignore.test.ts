import { describe, expect, spyOn, test } from "bun:test";
import type { Directory, File } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import { validateCapabilities } from "../src/capability.ts";
import { InvalidOptionsError } from "../src/errors.ts";
import {
  ADDITIONAL_IGNORES,
  availableSets,
  buildGitignore,
  copyGitignoreAssets,
  GITIGNORE_ENDPOINT,
  GITIGNORE_QUERY,
  GITIGNORE_TEMPLATES,
  gitignore,
  normalizeSet,
  PINNED_GITIGNORE,
  parseTemplate,
  readPinnedTemplate,
  updateGitignore,
} from "../src/gitignore.ts";
import { DropCalf } from "../src/index.ts";
import { resolveProfile } from "../src/profiles.ts";
import {
  mockDirectory,
  mockModuleSource,
  pinnedGitignore,
} from "./module-source.ts";

const pin = pinnedGitignore();

/**
 * A miniature upstream response: every default topic, a Patch section, a rule
 * repeated across sections and the CR-sensitive macOS rule. The builder and
 * updater tests run against this, so a pin refresh cannot break them.
 */
const topics = "visualstudiocode,linux,macos,windows,node,turbo";
const template = [
  `# Created by ${GITIGNORE_ENDPOINT}/${topics}`,
  `# Edit at https://www.toptal.com/developers/gitignore?templates=${topics}`,
  "",
  "### Linux ###",
  "*~",
  "*.log",
  "",
  "### macOS ###",
  ".DS_Store",
  "Icon\r\r",
  "",
  "### macOS Patch ###",
  "*.icloud",
  "",
  "### Node ###",
  "node_modules/",
  "*.log",
  "",
  "### Turbo ###",
  ".turbo",
  "",
  "### VisualStudioCode ###",
  ".vscode/*",
  "!.vscode/settings.json",
  "",
  "### Windows ###",
  "Thumbs.db",
  "",
  `# End of ${GITIGNORE_ENDPOINT}/${topics}`,
  "",
].join("\n");

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s composes gitignore after OSS and preserves owner bytes through init and update",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const names = resolveProfile(kind).map((capability) => capability.name);
      expect(names.indexOf("gitignore")).toBe(names.indexOf("oss") + 1);
      expect(names.indexOf("node")).toBe(names.indexOf("gitignore") + 1);
      const module = new DropCalf();
      const owner = "# scaffold ignores\r\ncustom/\r\n!keep/\r\n";
      for (const initial of ["", owner]) {
        const input = mockDirectory(
          initial ? new Map([[".gitignore", initial]]) : undefined,
        );
        const seeded = await module.init(input, kind, "tester", "sample");
        const expected = `${initial}${initial ? "\n" : ""}${buildGitignore(pin)}`;
        expect(await seeded.file(".gitignore").contents()).toBe(expected);
        expect(await module.update(seeded, kind)).toBe(seeded);
        const edited = seeded.withNewFile(
          ".gitignore",
          `${expected}\n# owner additions\n!node_modules/keep\n`,
        );
        expect(await module.update(edited, kind)).toBe(edited);
        const drifted = edited.withNewFile(
          ".gitignore",
          (await edited.file(".gitignore").contents()).replace(
            "node_modules/\n",
            "stale/\n",
          ),
        );
        const updated = await module.update(drifted, kind);
        expect(await updated.file(".gitignore").contents()).toBe(
          await edited.file(".gitignore").contents(),
        );
        expect(await module.update(updated, kind)).toBe(updated);
      }
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("gitignore update never creates missing blocks and validate explicitly skips without reading", async () => {
  const source = mockModuleSource();
  try {
    const capability = gitignore();
    if (typeof capability.update !== "function")
      throw new Error("gitignore has no update");
    for (const directory of [
      mockDirectory(),
      mockDirectory(new Map([[".gitignore", "# owner\r\nprivate/\r\n"]])),
    ])
      expect(await capability.update(directory)).toBe(directory);
    const report = await validateCapabilities({} as Directory, [capability]);
    expect(report).toEqual([
      {
        capability: "gitignore",
        status: "skipped",
        reason: (capability.validate as { reason: string }).reason,
      },
    ]);
    expect((capability.validate as { reason: string }).reason).toContain(
      "not tool acceptance",
    );
  } finally {
    source.mockRestore();
  }
});

/** The pinned template as the Dagger file handle `copyGitignoreAssets` consumes. */
const fakeFile = (contents: string) =>
  mockDirectory(new Map([["pin", contents]])).file("pin") as unknown as File;

const gitignoreOf = async (directory: Directory) =>
  (directory as ReturnType<typeof mockDirectory>).files.get(".gitignore");

test("the pinned artifact records the templates it was fetched from", () => {
  expect(PINNED_GITIGNORE).toBe("vendor/gitignore");
  expect(GITIGNORE_QUERY).toBe(GITIGNORE_TEMPLATES.join(","));
  expect(pin).toContain(`# Created by `);
  expect(pin).toContain(GITIGNORE_QUERY);
  expect(pin.endsWith("\n")).toBe(true);
});

test("the pinned artifact preserves the CR-sensitive macOS icon rule", () => {
  // gitignore.io emits `Icon\r\r`; an editor or fetch that normalises line
  // endings silently breaks the rule, so pin it byte-exact.
  expect(pin).toContain("\nIcon\r\r\n");
});

test("every default template resolves to a section in the pin", () => {
  const known = availableSets(pin);
  for (const name of GITIGNORE_TEMPLATES)
    expect(known).toContain(name.toLowerCase());
  expect(buildGitignore(pin)).toContain(ADDITIONAL_IGNORES);
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

  test("delimits both owned blocks", () => {
    expect(built).toContain(
      `# End of https://www.toptal.com/developers/gitignore/api/${GITIGNORE_QUERY}\n`,
    );
    expect(built).toContain("# End of drop-calf additional ignores\n");
    expect(built).not.toContain("### yarn ###");
    expect(built).not.toContain("\nvendor/\n");
  });

  test("appends the extras after a blank line", () => {
    expect(built).toContain(
      `\n\n# Created by drop-calf additional ignores\n# Additional ignores\n`,
    );
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

describe("updateGitignore", () => {
  const upstream = (
    topics: string,
    body = "stale/\n",
    host = GITIGNORE_ENDPOINT,
  ) => `# Created by ${host}/${topics}\n${body}# End of ${host}/${topics}\n`;

  test("preserves owner bytes and negation ordering around multiple blocks", () => {
    const before = "# owner header\r\n\\#literal\r\n!keep/\r\n\r\n";
    const between =
      "\r\n# unrelated block\r\n# Created by someone else\r\nowner/\r\n# End of someone else\r\n";
    const after = "\r\n!node_modules/keep\r\n# owner EOF";
    const old = `${before}${upstream("node")}${between}${upstream("linux")}${after}`;
    const wanted = `${before}${buildGitignore(template, ["node"]).split("\n# Created by drop-calf")[0]}${between}${buildGitignore(template, ["linux"]).split("\n# Created by drop-calf")[0]}${after}`;
    expect(updateGitignore(old, template)).toBe(wanted);
    expect(updateGitignore(wanted, template)).toBe(wanted);
  });

  test("uses URL topics, not section headings or the full pin", () => {
    const result = updateGitignore(
      upstream("linux", "### Node ###\n"),
      template,
    );
    expect(result).toContain("### Linux ###");
    expect(result).not.toContain("### Node ###");
    expect(result).not.toContain("# Additional ignores");
    expect(result).toContain(`${GITIGNORE_ENDPOINT}/linux`);
  });

  test("removes the retired standalone Yarn topic and preserves owner Yarn rules", () => {
    const result = updateGitignore(
      `${upstream("node,yarn", "### yarn ###\n.yarn/*\n")}\n# owner\n.yarn/owner-only\n`,
      template,
    );
    expect(result).toContain(`${GITIGNORE_ENDPOINT}/node\n`);
    expect(result).not.toContain("### yarn ###");
    expect(result).not.toContain("\n.yarn/*\n");
    expect(result).toEndWith("\n# owner\n.yarn/owner-only\n");
  });

  test("refreshes additional ignores independently and leaves owner vendor rules", () => {
    const old =
      "# Created by drop-calf additional ignores\nvendor/\nstale/\n# End of drop-calf additional ignores\n\nvendor/\n";
    expect(updateGitignore(old, template)).toBe(
      `${ADDITIONAL_IGNORES}\nvendor/\n`,
    );
  });

  test("supports legacy gitignore.io markers and an empty topic selection", () => {
    const result = updateGitignore(
      upstream("Node,yarn", "stale/\n", "https://www.gitignore.io/api"),
      template,
    );
    expect(result).toContain(`${GITIGNORE_ENDPOINT}/node\n`);
    const empty = buildGitignore(template, []);
    expect(updateGitignore(empty, template)).toBe(empty);
    expect(updateGitignore(upstream("yarn"), template)).toContain(
      `${GITIGNORE_ENDPOINT}/\n`,
    );
  });

  test("preserves CR-sensitive pinned rules and the absence of a final newline", () => {
    const old = upstream("macos").trimEnd();
    const result = updateGitignore(old, template);
    expect(result).toContain("\nIcon\r\r\n");
    expect(result.endsWith("\n")).toBe(false);
    expect(updateGitignore(result, template)).toBe(result);
  });

  test("never adopts unmarked lines or unrelated Created by comments", () => {
    const owner =
      "# owner\r\nnode_modules/\r\n!keep/\r\n# Created by https://example.com/api/node\r\n";
    expect(updateGitignore(owner, template)).toBe(owner);
    expect(updateGitignore("", template)).toBe("");
  });

  test.each([
    `# Created by ${GITIGNORE_ENDPOINT}/node\nowner/\n`,
    `# End of ${GITIGNORE_ENDPOINT}/node\n`,
    `# Created by ${GITIGNORE_ENDPOINT}/node\n# End of ${GITIGNORE_ENDPOINT}/linux\n`,
    `# Created by ${GITIGNORE_ENDPOINT}/node\n# Created by ${GITIGNORE_ENDPOINT}/linux\n`,
  ])("refuses malformed owned block markers: %j", (old) => {
    expect(() => updateGitignore(old, template)).toThrow(
      /cannot parse .gitignore/,
    );
  });

  test("refuses unsupported topics without replacing the block", () => {
    expect(() => updateGitignore(upstream("rust"), template)).toThrow(
      InvalidOptionsError,
    );
  });
});

describe("copyGitignoreAssets", () => {
  test("writes a generated .gitignore into the supplied directory", async () => {
    const output = await copyGitignoreAssets(
      mockDirectory(),
      fakeFile(template),
    );
    expect(await gitignoreOf(output)).toBe(buildGitignore(template));
  });

  test("defaults to every pinned template and honours an explicit subset", async () => {
    const all = await gitignoreOf(
      await copyGitignoreAssets(mockDirectory(), fakeFile(template)),
    );
    const subset = await gitignoreOf(
      await copyGitignoreAssets(mockDirectory(), fakeFile(template), ["node"]),
    );
    expect(subset).toBe(buildGitignore(template, ["node"]));
    expect(subset).not.toBe(all);
    expect(subset).not.toContain("### macOS ###");
  });

  test("rejects an unknown set before touching the directory", async () => {
    const input = mockDirectory();
    const write = spyOn(input, "withNewFile");
    await expect(
      copyGitignoreAssets(input, fakeFile(template), ["nope"]),
    ).rejects.toBeInstanceOf(InvalidOptionsError);
    expect(write).not.toHaveBeenCalled();
  });

  test("appends missing blocks without changing owner content, including EOF bytes", async () => {
    for (const owner of ["# owner\r\ncustom/\r\n", "# owner\ncustom/"]) {
      const input = mockDirectory(
        new Map([
          [".gitignore", owner],
          ["owner.txt", "untouched"],
        ]),
      );
      const output = await copyGitignoreAssets(input, fakeFile(template), [
        "node",
      ]);
      const wanted = `${owner}${owner.endsWith("\n") ? "" : "\n"}\n${buildGitignore(template, ["node"])}`;
      expect(await gitignoreOf(output)).toBe(wanted);
      expect(await output.file("owner.txt").contents()).toBe("untouched");
      expect(await copyGitignoreAssets(output, fakeFile(template))).toBe(
        output,
      );
    }
  });

  test("an explicit subset replaces only the upstream block and records the chosen URL", async () => {
    const output = await copyGitignoreAssets(
      mockDirectory(
        new Map([
          [".gitignore", `# owner\n${buildGitignore(template)}\n!keep\n`],
        ]),
      ),
      fakeFile(template),
      ["linux"],
    );
    expect(await gitignoreOf(output)).toBe(
      `# owner\n${buildGitignore(template, ["linux"])}\n!keep\n`,
    );
    expect(await gitignoreOf(output)).not.toContain(
      `${GITIGNORE_ENDPOINT}/${GITIGNORE_QUERY}`,
    );
  });

  test("rejects malformed owned markers before writing", async () => {
    const old = `# Created by ${GITIGNORE_ENDPOINT}/node\ncustom/\n`;
    const input = mockDirectory(new Map([[".gitignore", old]]));
    const write = spyOn(input, "withNewFile");
    await expect(
      copyGitignoreAssets(input, fakeFile(template)),
    ).rejects.toThrow(/end marker/);
    expect(write).not.toHaveBeenCalled();
  });

  test("propagates a missing pin instead of writing a partial file", async () => {
    const input = mockDirectory();
    const write = spyOn(input, "withNewFile");
    await expect(copyGitignoreAssets(input, fakeFile(""))).rejects.toThrow(
      /missing or malformed/,
    );
    expect(write).not.toHaveBeenCalled();
  });
});
