// Regenerates vendor/gitignore, the pinned gitignore.io response that
// src/gitignore.ts assembles .gitignore files from. Run it deliberately and
// review the diff: upstream templates change without notice, so refreshing is
// a reviewable change rather than something generation does on the fly.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  GITIGNORE_ENDPOINT,
  GITIGNORE_QUERY,
  PINNED_GITIGNORE,
} from "../src/capabilities/gitignore.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, PINNED_GITIGNORE);

const response = await fetch(`${GITIGNORE_ENDPOINT}/${GITIGNORE_QUERY}`);
if (!response.ok)
  throw new Error(
    `gitignore.io returned ${response.status} for ${GITIGNORE_QUERY}`,
  );
const contents = await response.text();

if (!contents.includes(`# Created by ${GITIGNORE_ENDPOINT}/${GITIGNORE_QUERY}`))
  throw new Error(
    "response is missing its expected provenance header; refusing to pin",
  );
if (!/^### .+ ###$/m.test(contents))
  throw new Error("response has no template sections; refusing to pin");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, contents);
process.stdout.write(
  `wrote ${PINNED_GITIGNORE} (${contents.split("\n").length} lines) for ${GITIGNORE_QUERY}\n`,
);
