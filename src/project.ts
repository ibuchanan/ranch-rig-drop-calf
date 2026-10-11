import { type Directory, dag } from "@dagger.io/dagger";
export type PackageJson = {
  name: string;
  version: string;
  type: "module";
  engines?: { node: string };
  private?: boolean;
  main?: string;
  types?: string;
  exports?: Record<string, { types: string; default: string }>;
  "size-limit"?: { name: string; path: string; limit: string }[];
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
  description?: string;
  author?: string;
  license?: string;
};

export type ProjectBlueprint = {
  packageJson: PackageJson;
  files: Map<string, string>;
  templates: string[];
};

export function createBlueprint(
  packageName: string,
  description: string,
  author: string,
): ProjectBlueprint {
  const packageJson: PackageJson = {
    name: packageName,
    version: "0.1.0",
    type: "module",
    scripts: {},
    devDependencies: {},
  };

  if (description) packageJson.description = description;
  if (author) packageJson.author = author;
  const files = new Map<string, string>();

  // `.gitignore` is deliberately absent: it is a pinned, seeded asset like the
  // OSS and docs trees, so the Dagger layer copies it in after rendering. See
  // src/gitignore.ts. The node baseline (`.nvmrc`, `.npmrc`, `@types/node`)
  // is absent for a different reason: it belongs to the `node` capability, not
  // to every blueprint. See src/node.ts. Authored config trees belong to their
  // capabilities: the blueprint carries only their paths, and generation reads
  // them from the module source after rendering.
  return { packageJson, files, templates: [] };
}

export function renderToDirectory(project: ProjectBlueprint): Directory {
  let dir = dag.directory();
  dir = dir.withNewFile(
    "package.json",
    `${JSON.stringify(project.packageJson, null, 2)}\n`,
  );
  for (const [path, contents] of project.files) {
    dir = dir.withNewFile(path, contents);
  }
  return dir;
}

export function buildReadme(
  packageName: string,
  description: string,
  scripts: Record<string, string> = {},
  profile?: string,
): string {
  const desc = description || "A TypeScript project.";
  const forge =
    profile === "forge-app"
      ? " Scaffold your Forge manifest and app before deploying."
      : "";
  const test = scripts.test
    ? "\n\n## Test\n\nRun `npm test` (which uses `bun test`). Add tests under `tests/` when ready.\n"
    : "";
  const evals = scripts.eval
    ? "\n## Evaluations\n\nRun `npm run eval` to evaluate the supplied examples, then `npm run view` to inspect results.\n"
    : "";
  return `# ${packageName}

${desc}

<!-- drop-calf:usage start -->
## Get started

This is a configuration starter, not a complete application. Add \`src/index.ts\`
before building.${forge} Install dependencies and use the scripts below after
adding project source.

\`\`\`bash
npm install
npm run build
\`\`\`

The build writes compiled files to \`dist/\`.${test}${evals}
## Lint & format

\`\`\`bash
npm run lint
npm run format:check
npm run format
\`\`\`
<!-- drop-calf:usage end -->
`;
}
