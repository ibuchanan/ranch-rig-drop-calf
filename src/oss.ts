import type { Directory } from "@dagger.io/dagger";
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

export function transformOssTemplate(
  path: string,
  contents: string,
  name: string,
  owner: string,
): string {
  if (path === ".atlassian/OWNER") return owner;
  if (path === "CONTRIBUTING.md" || path === "README.md")
    return contents.replaceAll("[Project name]", name);
  if (path === "LICENSE")
    return contents.replaceAll("[YYYY]", String(new Date().getFullYear()));
  return contents;
}

export async function copyOssAssets(
  destination: Directory,
  source: Directory,
  name: string,
  owner: string,
  paths: readonly string[] = OSS_ASSETS,
): Promise<Directory> {
  let result = destination;
  for (const path of paths) {
    const file = source.file(path);
    if (path === "CODE_OF_CONDUCT.md" || path === "SECURITY.md")
      result = result.withFile(path, file);
    else
      result = result.withNewFile(
        path,
        transformOssTemplate(path, await file.contents(), name, owner),
      );
  }
  return result;
}

export function seedOssDocuments(
  project: ProjectBlueprint,
  owner: string,
): void {
  if (!/^[a-z][a-z0-9._-]*$/i.test(owner)) {
    throw new Error("OSS owner must be a nonempty staff ID");
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
