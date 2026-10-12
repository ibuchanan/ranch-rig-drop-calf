import { type Directory, dag, type File } from "@dagger.io/dagger";
import { type Capability, noOp } from "./capability.ts";
import { InvalidOptionsError } from "./options.ts";
import { ParseError } from "./errors.ts";

// gitignore.io redirects here; use the canonical host when refreshing the pin.
export const GITIGNORE_ENDPOINT =
  "https://www.toptal.com/developers/gitignore/api";

/** Default topics; section ordering comes from the pinned upstream response. */
export const GITIGNORE_TEMPLATES = [
  "visualstudiocode",
  "linux",
  "macos",
  "windows",
  "node",
  "turbo",
] as const;

export const GITIGNORE_QUERY = GITIGNORE_TEMPLATES.join(",");

/** Refresh deliberately with `bun run refresh:gitignore` and review the diff. */
export const PINNED_GITIGNORE = "vendor/gitignore";

/** Additional defaults have their own block, independent of topic selection. */
export const ADDITIONAL_IGNORES = `# Created by drop-calf additional ignores
# Additional ignores
.fallow/
.scratch/
.session/

# CocoIndex Code (ccc)
/.cocoindex_code/
# End of drop-calf additional ignores
`;

const EXTRAS = "drop-calf additional ignores";
const SECTION_HEADING = /^### (.+?) ###$/;
const TRAILER = /^# End of /;
const TOPIC_URL =
  /^https:\/\/(?:www\.toptal\.com\/developers\/gitignore|(?:www\.)?gitignore\.io)\/api\/([^\s]*)$/;

/** Fold upstream Patch sections onto their topic name. */
export function normalizeSet(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+patch$/u, "");
}

export type GitignoreSection = {
  set: string;
  heading: string;
  lines: string[];
};

/** Preserve pinned rule bytes, including the CR-sensitive macOS Icon rule. */
export function parseTemplate(template: string): {
  provenance: string[];
  sections: GitignoreSection[];
} {
  const provenance: string[] = [];
  const sections: GitignoreSection[] = [];
  let current: GitignoreSection | undefined;
  for (const line of template.split("\n")) {
    if (TRAILER.test(line)) continue;
    const heading = SECTION_HEADING.exec(line);
    if (heading?.[1] !== undefined) {
      current = { set: normalizeSet(heading[1]), heading: line, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
    else if (line.trim()) provenance.push(line);
  }
  return { provenance, sections };
}

export function availableSets(template: string): string[] {
  return [
    ...new Set(parseTemplate(template).sections.map((section) => section.set)),
  ].sort();
}

/** Build one upstream block; its URLs record the actual selected topics. */
function buildTopicBlock(template: string, sets: readonly string[]): string {
  const { sections } = parseTemplate(template);
  const known = new Set(sections.map((section) => section.set));
  const wanted = new Set(sets.map(normalizeSet));
  const unknown = [...wanted].filter((set) => !known.has(set));
  if (unknown.length)
    throw new InvalidOptionsError(
      `Unknown ignore set${unknown.length > 1 ? "s" : ""} ${unknown
        .map((set) => JSON.stringify(set))
        .join(", ")}; choose from ${[...known].sort().join(", ")}.`,
    );
  const query = [...wanted].join(",");
  const url = `${GITIGNORE_ENDPOINT}/${query}`;
  const seen = new Set<string>();
  const body: string[] = [];
  for (const section of sections) {
    if (!wanted.has(section.set)) continue;
    body.push(section.heading);
    for (const line of section.lines) {
      const rule = line.trim();
      if (rule && !rule.startsWith("#")) {
        if (seen.has(rule)) continue;
        seen.add(rule);
      }
      body.push(line);
    }
  }
  return `${collapse([
    `# Created by ${url}`,
    `# Edit at https://www.toptal.com/developers/gitignore?templates=${query}`,
    "",
    ...body,
  ]).join("\n")}\n\n# End of ${url}\n`;
}

/** Init seeds the upstream topic block followed by the additional-ignore block. */
export function buildGitignore(
  template: string,
  sets: readonly string[] = GITIGNORE_TEMPLATES,
): string {
  return `${buildTopicBlock(template, sets)}\n${ADDITIONAL_IGNORES}`;
}

/**
 * Replace complete owned blocks, never individual lines or surrounding bytes.
 * A retired Yarn topic is removed from existing selections; other unknown topics
 * fail before writing. Missing blocks are seeded only by an explicit copy/init.
 */
function rewriteBlocks(
  contents: string,
  template: string,
  seed = false,
  sets?: readonly string[],
): string {
  let open: { start: number; source: string; topics?: string[] } | undefined;
  let cursor = 0;
  let result = "";
  let topicsFound = false;
  let extrasFound = false;
  for (const match of contents.matchAll(/[^\n]+\n?|\n/g)) {
    const line = match[0].replace(/\r?\n$/, "");
    const marker = /^# (Created by|End of) (.+)$/.exec(line);
    if (!marker?.[2]) continue;
    const source = marker[2];
    const topics = TOPIC_URL.exec(source);
    if (source !== EXTRAS && !topics) continue;
    if (marker[1] === "Created by") {
      if (open)
        throw new ParseError(".gitignore", "nested managed block markers");
      open = {
        start: match.index,
        source,
        topics: topics ? (topics[1] ? topics[1].split(",") : []) : undefined,
      };
    } else {
      if (!open || open.source !== source)
        throw new ParseError(
          ".gitignore",
          "unmatched managed block end marker",
        );
      const replacement = open.topics
        ? buildTopicBlock(
            template,
            sets ??
              open.topics.map(normalizeSet).filter((set) => set !== "yarn"),
          )
        : ADDITIONAL_IGNORES;
      // The marker's newline belongs to the block; an EOF marker stays at EOF.
      result +=
        contents.slice(cursor, open.start) +
        (match[0].endsWith("\n") ? replacement : replacement.slice(0, -1));
      cursor = match.index + match[0].length;
      if (open.topics) topicsFound = true;
      else extrasFound = true;
      open = undefined;
    }
  }
  if (open)
    throw new ParseError(".gitignore", "missing managed block end marker");
  result += contents.slice(cursor);
  if (seed) {
    const missing = [
      ...(topicsFound
        ? []
        : [buildTopicBlock(template, sets ?? GITIGNORE_TEMPLATES)]),
      ...(extrasFound ? [] : [ADDITIONAL_IGNORES]),
    ];
    if (missing.length)
      result += `${result && !result.endsWith("\n") ? "\n" : ""}${result ? "\n" : ""}${missing.join("\n")}`;
  }
  return result;
}

/** Update uses the topics recorded in each owned block; unmarked files are intact. */
export function updateGitignore(contents: string, template: string): string {
  return rewriteBlocks(contents, template);
}

/** Refuse an absent or malformed pin rather than silently emitting only extras. */
export async function readPinnedTemplate(source: File): Promise<string> {
  const contents = await source.contents();
  if (!parseTemplate(contents).sections.length)
    throw new Error(
      `${PINNED_GITIGNORE} is missing or malformed; run \`bun run refresh:gitignore\` and commit it.`,
    );
  return contents;
}

/** Explicit init/copy seeds missing blocks and preserves all unowned content. */
export async function copyGitignoreAssets(
  destination: Directory,
  source: File,
  sets?: readonly string[],
): Promise<Directory> {
  const template = await readPinnedTemplate(source);
  // Reject an explicit unsupported selection even if no upstream block is present.
  if (sets) buildTopicBlock(template, sets);
  const contents = (await destination.exists(".gitignore"))
    ? await destination.file(".gitignore").contents()
    : "";
  const wanted = rewriteBlocks(contents, template, true, sets);
  return wanted === contents
    ? destination
    : destination.withNewFile(".gitignore", wanted);
}

export function gitignore(): Capability {
  return {
    name: "gitignore",
    documentation: {
      tools: [
        {
          name: "gitignore.io",
          url: "https://www.gitignore.io/",
          purpose:
            "Provides template rules for Node, TypeScript, Forge, and other tool ecosystems",
        },
      ],
      init: "Seed two owned blocks from pinned gitignore.io topics and Drop Calf defaults, retaining unowned scaffold rules.",
      update:
        "Replace existing owned blocks from recorded topics/pinned defaults; preserve bytes outside blocks and do not seed missing blocks.",
    },
    init(project) {
      project.templates.push({
        path: PINNED_GITIGNORE,
        seed: (destination, source) =>
          copyGitignoreAssets(destination, source.file(PINNED_GITIGNORE)),
      });
    },
    async update(directory) {
      if (!(await directory.exists(".gitignore"))) return directory;
      const contents = await directory.file(".gitignore").contents();
      const template = await readPinnedTemplate(
        dag.currentModule().source().file(PINNED_GITIGNORE),
      );
      const wanted = updateGitignore(contents, template);
      return wanted === contents
        ? directory
        : directory.withNewFile(".gitignore", wanted);
    },
    validate: noOp(
      "Git treats ineffective ignore patterns as nonmatching; checking which paths are ignored would enforce policy, not tool acceptance.",
    ),
  };
}

/** Collapse blank-line runs left by omitted sections without changing rule bytes. */
function collapse(lines: string[]): string[] {
  const collapsed: string[] = [];
  for (const line of lines) {
    if (!line.trim() && !collapsed.at(-1)?.trim()) continue;
    collapsed.push(line);
  }
  while (collapsed.at(-1)?.trim() === "") collapsed.pop();
  while (collapsed[0]?.trim() === "") collapsed.shift();
  return collapsed;
}
