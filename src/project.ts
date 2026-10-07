import { type Directory, dag } from "@dagger.io/dagger";
import { OSS_LICENSE } from "./oss.ts";
import { NODE_MAJOR } from "./versions.ts";

export type PackageJson = {
  name: string;
  version: string;
  type: "module";
  engines: { node: string };
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
  license: typeof OSS_LICENSE;
};

export type ProjectBlueprint = {
  packageJson: PackageJson;
  files: Map<string, string>;
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
    engines: { node: `${NODE_MAJOR}.x` },
    license: OSS_LICENSE,
    scripts: {},
    devDependencies: {},
  };

  if (description) packageJson.description = description;
  if (author) packageJson.author = author;
  const files = new Map<string, string>([
    [".nvmrc", `${NODE_MAJOR}\n`],
    [".gitignore", buildGitignore()],
    [".editorconfig", buildEditorconfig()],
    [
      "tsconfig.json",
      `${JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "NodeNext",
            moduleResolution: "NodeNext",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            forceConsistentCasingInFileNames: true,
            declaration: true,
            outDir: "dist",
            rootDir: "src",
          },
          include: ["src"],
        },
        null,
        2,
      )}\n`,
    ],
  ]);

  return { packageJson, files };
}

export function renderToDirectory(project: ProjectBlueprint): Directory {
  let dir = dag.directory();
  dir = dir.withNewFile(
    "package.json",
    `${JSON.stringify(project.packageJson, null, 2)}\n`,
  );
  for (const [path, contents] of project.files) {
    dir = dir.withNewFile(
      path,
      contents,
      path === "scripts/forge-vars-from-secretspec.sh"
        ? { permissions: 0o755 }
        : {},
    );
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

function buildGitignore(): string {
  return `# dependencies
node_modules

# build output
dist
out
*.tsbuildinfo

# test coverage
coverage

# logs
logs
*.log

# environment
.env
.env.*

# editor and OS
.DS_Store
.idea
.vscode
`;
}

function buildEditorconfig(): string {
  return `root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
trim_trailing_whitespace = true
indent_style = space
indent_size = 2

[*.md]
trim_trailing_whitespace = false
`;
}
