// Regenerates vendor/oss-templates, the pinned copy of the OSS templates that
// src/oss.ts copies into generated projects. The upstream is a private
// Bitbucket repository, so this clones it with your own Git credentials; the
// pin is what lets Dagger load the module from a Git ref without them. Run it
// deliberately and review the diff.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OSS_ASSETS,
  OSS_UPSTREAM,
  PINNED_OSS,
  PINNED_OSS_UPSTREAM,
} from "../src/capabilities/oss.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, PINNED_OSS);
const checkout = mkdtempSync(join(tmpdir(), "drop-calf-oss-"));

try {
  execFileSync(
    "git",
    ["clone", "--quiet", "--depth=1", OSS_UPSTREAM, checkout],
    { stdio: "inherit" },
  );
  const commit = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();

  // The same shape the pinned-template test checks: a new upstream template
  // should be a decision to add to OSS_ASSETS, not something silently dropped.
  const upstream = [
    ...readdirSync(checkout).filter(
      (name) => name.endsWith(".md") || name === "LICENSE",
    ),
    ...readdirSync(join(checkout, ".atlassian")).map(
      (name) => `.atlassian/${name}`,
    ),
  ];
  const untracked = upstream.filter(
    (path) => !(OSS_ASSETS as readonly string[]).includes(path),
  );
  if (untracked.length > 0)
    throw new Error(
      `upstream has templates missing from OSS_ASSETS: ${untracked.join(", ")}; refusing to pin`,
    );

  rmSync(target, { recursive: true, force: true });
  for (const path of OSS_ASSETS) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    cpSync(join(checkout, path), join(target, path));
  }
  writeFileSync(join(root, PINNED_OSS_UPSTREAM), `${OSS_UPSTREAM} ${commit}\n`);
  process.stdout.write(
    `wrote ${OSS_ASSETS.length} files to ${PINNED_OSS} from ${commit}\n`,
  );
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
