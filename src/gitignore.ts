import type { Directory, File } from "@dagger.io/dagger";
import { InvalidOptionsError } from "./profiles.ts";

// gitignore.io redirects here; use the canonical host so refreshing does not
// depend on the redirect.
export const GITIGNORE_ENDPOINT =
  "https://www.toptal.com/developers/gitignore/api";

/**
 * Ordered gitignore.io templates behind the default `.gitignore`. Order matters:
 * gitignore.io concatenates templates in request order, and first-occurrence
 * de-duplication keeps the earlier template's spelling of a shared rule.
 */
export const GITIGNORE_TEMPLATES = [
  "visualstudiocode",
  "linux",
  "macos",
  "windows",
  "node",
  "turbo",
] as const;

export const GITIGNORE_QUERY = GITIGNORE_TEMPLATES.join(",");

/**
 * Pinned gitignore.io response for `GITIGNORE_QUERY`. Generation reads this so
 * output stays deterministic and reviewable; refresh it deliberately with
 * `bun run refresh:gitignore` and read the diff.
 */
export const PINNED_GITIGNORE = "vendor/gitignore";

/** Personal defaults appended after every selected upstream template. */
export const ADDITIONAL_IGNORES = `# Additional ignores
.fallow/
.scratch/
.session/

# CocoIndex Code (ccc)
/.cocoindex_code/
`;

const SECTION_HEADING = /^### (.+?) ###$/;
const TRAILER = /^# End of /;

/**
 * gitignore.io names sections after the template but appends " Patch" to the
 * variants that patch an earlier template. Fold both onto the set name so
 * `--ignore-sets node` selects `### Node ###` and `### Node Patch ###`.
 */
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

/**
 * Split a gitignore.io response into its provenance header and its `### Name ###`
 * sections. The trailing `# End of ...` marker is dropped; the `Created by` and
 * `Edit at` lines are kept so generated files record where they came from and
 * how to regenerate them.
 */
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

/** Every set name the pinned template can satisfy, sorted for stable messages. */
export function availableSets(template: string): string[] {
  return [
    ...new Set(parseTemplate(template).sections.map((section) => section.set)),
  ].sort();
}

/**
 * Assemble a complete `.gitignore` from the pinned template: the provenance
 * header, the selected sections with first-occurrence rule de-duplication, and
 * the personal defaults.
 */
export function buildGitignore(
  template: string,
  sets: readonly string[] = GITIGNORE_TEMPLATES,
): string {
  const { provenance, sections } = parseTemplate(template);
  const known = new Set(sections.map((section) => section.set));
  const wanted = new Set(sets.map(normalizeSet));
  const unknown = [...wanted].filter((set) => !known.has(set));
  if (unknown.length)
    throw new InvalidOptionsError(
      `Unknown ignore set${
        unknown.length > 1 ? "s" : ""
      } ${unknown.map((set) => JSON.stringify(set)).join(", ")}; choose from ${[
        ...known,
      ]
        .sort()
        .join(", ")}.`,
    );
  const seen = new Set<string>();
  const body: string[] = [];
  for (const section of sections) {
    if (!wanted.has(section.set)) continue;
    // Keep gitignore.io's own section headings: they are comments, and they
    // record which template each block of rules came from.
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
  return `${collapse([...provenance, "", ...body]).join("\n")}\n\n${ADDITIONAL_IGNORES}`;
}

/**
 * Line-set merge for `sync`: existing lines, comments, and ordering are the
 * user's and are never rewritten. Only rules absent from the existing file are
 * appended, so repeated runs converge. Provenance and section comments are
 * deliberately not injected into a file the user already owns.
 */
export function mergeGitignore(existing: string, wanted: string): string {
  const present = new Set(existing.split(/\r?\n/u).map((line) => line.trim()));
  const additions = wanted.split("\n").filter((line) => {
    const rule = line.trim();
    return rule !== "" && !rule.startsWith("#") && !present.has(rule);
  });
  if (!additions.length) return existing;
  return `${existing}${
    existing && !existing.endsWith("\n") ? "\n" : ""
  }${additions.join("\n")}\n`;
}

/**
 * Read the pinned response through Dagger, rejecting a checkout or published
 * module where the pin did not ship. A bare `.gitignore` of personal extras
 * would otherwise look like success.
 */
export async function readPinnedTemplate(source: File): Promise<string> {
  const contents = await source.contents();
  if (!parseTemplate(contents).sections.length)
    throw new Error(
      `${PINNED_GITIGNORE} is missing or malformed; run \`bun run refresh:gitignore\` and commit it.`,
    );
  return contents;
}

/**
 * Copy a generated `.gitignore` built from `source` into `destination`.
 * Unlike sync, an explicit copy replaces any existing `.gitignore`; callers that
 * must preserve user lines should merge with `mergeGitignore` instead.
 */
export async function copyGitignoreAssets(
  destination: Directory,
  source: File,
  sets?: readonly string[],
): Promise<Directory> {
  const contents = buildGitignore(await readPinnedTemplate(source), sets);
  return destination.withNewFile(".gitignore", contents);
}

/** Collapse blank-line runs left behind by dropped sections, and trim the ends. */
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
