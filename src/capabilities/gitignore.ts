import { type Directory, dag, type File } from "@dagger.io/dagger";
import { type Capability, noOp } from "../core/capability.ts";
import { InvalidOptionsError, ParseError } from "../core/errors.ts";

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

/** Reject topics the pinned upstream template does not define. */
function rejectUnknownSets(
  wanted: ReadonlySet<string>,
  sections: readonly GitignoreSection[],
): void {
  const known = new Set(sections.map((section) => section.set));
  const unknown = [...wanted].filter((set) => !known.has(set));
  if (!unknown.length) return;
  throw new InvalidOptionsError(
    `Unknown ignore set${unknown.length > 1 ? "s" : ""} ${unknown
      .map((set) => JSON.stringify(set))
      .join(", ")}; choose from ${[...known].sort().join(", ")}.`,
  );
}

/** Keeps comments and blanks, and each rule only the first time it appears. */
function firstSighting(): (line: string) => boolean {
  const seen = new Set<string>();
  return (line) => {
    const rule = line.trim();
    if (!rule || rule.startsWith("#")) return true;
    if (seen.has(rule)) return false;
    seen.add(rule);
    return true;
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

/** Build one upstream block; its URLs record the actual selected topics. */
function buildTopicBlock(template: string, sets: readonly string[]): string {
  const { sections } = parseTemplate(template);
  const wanted = new Set(sets.map(normalizeSet));
  rejectUnknownSets(wanted, sections);
  const query = [...wanted].join(",");
  const url = `${GITIGNORE_ENDPOINT}/${query}`;
  const keep = firstSighting();
  const body = sections
    .filter((section) => wanted.has(section.set))
    .flatMap((section) => [section.heading, ...section.lines.filter(keep)]);
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

/** The two kinds of block Drop Calf owns; each is replaced whole, never line by line. */
const BLOCK_KINDS = ["topics", "extras"] as const;
type BlockKind = (typeof BLOCK_KINDS)[number];

/** An upstream topic block records its topics; the additional-ignores block has none. */
type BlockSpec = { kind: "extras" } | { kind: "topics"; topics: string[] };

type BlockMarker = { opens: boolean; source: string; spec: BlockSpec };

/** Only owned markers count; other `# Created by` comments are owner content. */
function parseMarker(line: string): BlockMarker | undefined {
  const marker = /^# (Created by|End of) (.+)$/.exec(line);
  if (!marker?.[2]) return undefined;
  const opens = marker[1] === "Created by";
  const source = marker[2];
  if (source === EXTRAS) return { opens, source, spec: { kind: "extras" } };
  const url = TOPIC_URL.exec(source);
  if (!url) return undefined;
  const topics = url[1] ? url[1].split(",") : [];
  return { opens, source, spec: { kind: "topics", topics } };
}

/** The block as it should now read: recorded topics unless the caller selects others. */
function replacementBlock(
  spec: BlockSpec,
  template: string,
  sets: readonly string[] | undefined,
): string {
  if (spec.kind === "extras") return ADDITIONAL_IGNORES;
  return buildTopicBlock(
    template,
    sets ?? spec.topics.map(normalizeSet).filter((set) => set !== "yarn"),
  );
}

/** Separate appended blocks from existing content by exactly one blank line. */
function appendBlocks(contents: string, blocks: string[]): string {
  if (!blocks.length) return contents;
  const separator = !contents ? "" : contents.endsWith("\n") ? "\n" : "\n\n";
  return contents + separator + blocks.join("\n");
}

type Marker = BlockMarker & { index: number; text: string };

/** Owned markers in file order, with where each sits; computed lazily. */
function* scanMarkers(contents: string): Generator<Marker> {
  for (const match of contents.matchAll(/[^\n]+\n?|\n/g)) {
    const marker = parseMarker(match[0].replace(/\r?\n$/, ""));
    if (marker) yield { ...marker, index: match.index, text: match[0] };
  }
}

/** A complete owned block: its opening marker through the end marker's line. */
type OwnedBlock = {
  spec: BlockSpec;
  start: number;
  end: number;
  /** An end marker at EOF has no newline, and the replacement must not add one. */
  endsWithNewline: boolean;
};

const gitignoreError = (message: string) =>
  new ParseError(".gitignore", message);

/** Pairs each opening marker with its matching end, failing at the first malformed marker. */
function* ownedBlocks(contents: string): Generator<OwnedBlock> {
  const markers = scanMarkers(contents);
  for (const open of markers) {
    if (!open.opens) throw gitignoreError("unmatched managed block end marker");
    const close = markers.next();
    if (close.done) throw gitignoreError("missing managed block end marker");
    if (close.value.opens) throw gitignoreError("nested managed block markers");
    if (close.value.source !== open.source)
      throw gitignoreError("unmatched managed block end marker");
    yield {
      spec: open.spec,
      start: open.index,
      end: close.value.index + close.value.text.length,
      endsWithNewline: close.value.text.endsWith("\n"),
    };
  }
}

/** The owned blocks init adds when the file lacks them. */
const SEEDED_BLOCKS: Record<
  BlockKind,
  (template: string, sets?: readonly string[]) => string
> = {
  topics: (template, sets) =>
    buildTopicBlock(template, sets ?? GITIGNORE_TEMPLATES),
  extras: () => ADDITIONAL_IGNORES,
};

/**
 * Replace complete owned blocks, never individual lines or surrounding bytes,
 * and report which kinds were present. A retired Yarn topic is removed from
 * existing selections; other unknown topics fail before writing.
 */
function replaceBlocks(
  contents: string,
  template: string,
  sets?: readonly string[],
): { text: string; found: ReadonlySet<BlockKind> } {
  let cursor = 0;
  let text = "";
  const found = new Set<BlockKind>();
  for (const block of ownedBlocks(contents)) {
    const replacement = replacementBlock(block.spec, template, sets);
    // The marker's newline belongs to the block; an EOF marker stays at EOF.
    text +=
      contents.slice(cursor, block.start) +
      (block.endsWithNewline ? replacement : replacement.slice(0, -1));
    cursor = block.end;
    found.add(block.spec.kind);
  }
  return { text: text + contents.slice(cursor), found };
}

/** Update uses the topics recorded in each owned block; unmarked files are intact. */
export function updateGitignore(contents: string, template: string): string {
  return replaceBlocks(contents, template).text;
}

/** Init does the same, then seeds whichever owned blocks the file lacks. */
function seedGitignore(
  contents: string,
  template: string,
  sets?: readonly string[],
): string {
  const { text, found } = replaceBlocks(contents, template, sets);
  return appendBlocks(
    text,
    BLOCK_KINDS.filter((kind) => !found.has(kind)).map((kind) =>
      SEEDED_BLOCKS[kind](template, sets),
    ),
  );
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
  const wanted = seedGitignore(contents, template, sets);
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
