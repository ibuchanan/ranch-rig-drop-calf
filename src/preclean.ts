import { OSS_ASSETS } from "./oss.ts";
import { buildProject } from "./profiles.ts";

export type PrecleanOperation =
  | { action: "rename"; path: string; to: string }
  | { action: "delete"; path: string };

export type PrecleanPlan = {
  files: ReadonlyMap<string, string>;
  operations: PrecleanOperation[];
};

export const UNWANTED = [
  "AGENTS.md",
  ".eslint",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  ".eslintrc.yaml",
  ".eslintrc.yml",
  "eslint.config.js",
  "eslint.config.cjs",
  "eslint.config.mjs",
  ".eslintignore",
];

export function planPreclean(
  files: ReadonlyMap<string, string>,
  packageName: string,
): PrecleanPlan {
  const manifest = files.get("manifest.yml");
  const packageJson = files.get("package.json");
  if (
    !manifest ||
    !packageJson ||
    !/^app:\s*$/m.test(manifest) ||
    !/^\s+id:\s*ari:cloud:ecosystem::app\//m.test(manifest) ||
    !/^modules:\s*$/m.test(manifest)
  )
    throw new Error(
      "preclean: expected a Forge-created project with manifest.yml and package.json",
    );
  let pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    scripts?: Record<string, string>;
  };
  try {
    pkg = JSON.parse(packageJson);
  } catch {
    throw new Error("preclean: cannot parse package.json");
  }
  if (
    !pkg ||
    !Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).some((name) =>
      name.startsWith("@forge/"),
    )
  )
    throw new Error("preclean: expected Forge dependencies in package.json");
  if (
    files.get("README.md")?.includes("<!-- drop-calf:usage start -->") ||
    (files.has(".nvmrc") && files.has("biome.json")) ||
    pkg.scripts?.["format:check"] === "biome format"
  )
    throw new Error("preclean: already generated or maintained by Drop Calf");
  if (!/^eslint(?:\s|$)/.test(pkg.scripts?.lint ?? ""))
    throw new Error(
      "preclean: expected a Forge-created ESLint starter project",
    );

  // Only the generated path names matter here; no OSS contents leave preclean.
  const project = buildProject("forge-app", packageName, "preclean");
  const outputs = ["package.json", ...project.files.keys(), ...OSS_ASSETS];
  const operations: PrecleanOperation[] = [];
  for (const path of outputs) {
    if (!files.has(path) || UNWANTED.includes(path)) continue;
    const to = `${path}.old`;
    if (files.has(to))
      throw new Error(
        `preclean: backup ${to} already exists; resolve the collision before precleaning`,
      );
    operations.push({ action: "rename", path, to });
  }
  for (const path of UNWANTED) {
    if (files.has(path)) operations.push({ action: "delete", path });
  }
  return { files, operations };
}

export function applyPreclean(plan: PrecleanPlan): Map<string, string> {
  const files = new Map(plan.files);
  for (const operation of plan.operations) {
    if (operation.action === "rename") {
      const contents = files.get(operation.path);
      if (contents === undefined || files.has(operation.to))
        throw new Error(
          `preclean: cannot safely rename ${operation.path} to ${operation.to}`,
        );
      files.set(operation.to, contents);
    }
    files.delete(operation.path);
  }
  return files;
}
