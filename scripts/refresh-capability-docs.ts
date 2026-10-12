import { readFileSync, writeFileSync } from "node:fs";
import {
  INVENTORY_END,
  INVENTORY_START,
  REFERENCE_END,
  REFERENCE_FILES,
  REFERENCE_START,
  renderCapabilityInventory,
  renderCapabilityReference,
  replaceGeneratedBlock,
} from "./capability-reference.ts";

const root = new URL("../", import.meta.url);
const reference = renderCapabilityReference();
const outputs = [
  ...REFERENCE_FILES.map((path) => ({
    path,
    start: REFERENCE_START,
    end: REFERENCE_END,
    block: reference,
  })),
  {
    path: "specs/01-project-kinds.md",
    start: INVENTORY_START,
    end: INVENTORY_END,
    block: renderCapabilityInventory(),
  },
].map(({ path, start, end, block }) => {
  const url = new URL(path, root);
  const contents = readFileSync(url, "utf8");
  return {
    url,
    contents,
    updated: replaceGeneratedBlock(contents, start, end, block),
  };
});

for (const { url, contents, updated } of outputs) {
  if (updated !== contents) writeFileSync(url, updated);
}
