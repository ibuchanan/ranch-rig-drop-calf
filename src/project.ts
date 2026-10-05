import { type Directory, dag } from "@dagger.io/dagger";
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
  license?: string;
};

export type ProjectBlueprint = {
  packageJson: PackageJson;
  files: Map<string, string>;
};

const LICENSE_TEXTS: Record<string, string> = {
  mit: `MIT License

Copyright (c) <%= year %> <%= author %>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`,
  isc: `ISC License

Copyright (c) <%= year %> <%= author %>

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`,
};

export function createBlueprint(
  packageName: string,
  description: string,
  license: string,
  author: string,
): ProjectBlueprint {
  const lcLicense = license.toLowerCase();
  const packageJson: PackageJson = {
    name: packageName,
    version: "0.1.0",
    type: "module",
    engines: { node: `${NODE_MAJOR}.x` },
    scripts: {},
    devDependencies: {},
  };

  if (description) packageJson.description = description;
  if (author) packageJson.author = author;
  if (lcLicense !== "none") packageJson.license = license;

  const files = new Map<string, string>([
    [".nvmrc", `${NODE_MAJOR}\n`],
    [".gitignore", buildGitignore()],
    [".editorconfig", buildEditorconfig()],
    ["README.md", buildReadme(packageName, description)],
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

  if (lcLicense !== "none" && LICENSE_TEXTS[lcLicense]) {
    files.set(
      "LICENSE",
      LICENSE_TEXTS[lcLicense]
        .replace("<%= year %>", String(new Date().getFullYear()))
        .replace("<%= author %>", author || packageName),
    );
  }

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
