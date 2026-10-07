import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ProjectBlueprint } from "./project.ts";

export const OSS_LICENSE = "Apache-2.0";

export const OSS_ASSETS = [
  "LICENSE",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "README.md",
  "SECURITY.md",
  ".atlassian/OWNER",
] as const;

const DEVELOPMENT = `# Development

Install dependencies with \`npm install\`. Run the checks before sending a pull request:

\`\`\`sh
npm run lint
npm run format:check
npm run typecheck
{{test-command}}
\`\`\`

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution process.
`;

export function seedOssDocuments(
  project: ProjectBlueprint,
  owner: string,
): void {
  if (!/^[a-z][a-z0-9._-]*$/i.test(owner)) {
    throw new Error("OSS owner must be a nonempty staff ID");
  }
  for (const path of OSS_ASSETS) {
    let contents = readFileSync(
      fileURLToPath(
        new URL(`../vendor/oss-templates/${path}`, import.meta.url),
      ),
      "utf8",
    );
    if (path === ".atlassian/OWNER") contents = owner;
    if (path === "CONTRIBUTING.md" || path === "README.md")
      contents = contents.replaceAll(
        "[Project name]",
        project.packageJson.name,
      );
    if (path === "LICENSE")
      contents = contents.replaceAll(
        "[YYYY]",
        String(new Date().getFullYear()),
      );
    project.files.set(path, contents);
  }
  // The official template does not contain DEVELOPMENT.md; this guide is generated separately.
  project.files.set(
    "DEVELOPMENT.md",
    DEVELOPMENT.replace(
      "{{test-command}}",
      project.packageJson.scripts.test
        ? "npm run test"
        : "# No test script for this project kind",
    ),
  );
}
