import type { ProjectBlueprint } from "./project.ts";

// Authored OSS documents: edit these seeds deliberately; only marked tokens are substituted.
const CONTRIBUTING = `# Contributing to {{project}}

Thank you for considering a contribution! Issues and pull requests are welcome.
Please add tests for fixes and features, follow the existing style, and keep
unrelated changes in separate pull requests. For larger changes, open an issue
first to discuss the approach.

See [DEVELOPMENT.md](DEVELOPMENT.md) for setup and checks, and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.
`;

const CODE_OF_CONDUCT = `# Code of Conduct

We pledge to make participation in this project a harassment-free experience
for everyone, regardless of background or identity. Be respectful and
constructive. Harassment, personal attacks, and publishing private information
without permission are unacceptable.

Report concerns privately to the project maintainers. Maintainers will review
reports confidentially and may remove contributions or participants who violate
this code.
`;

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
  const name = project.packageJson.name;
  project.files.set(
    "CONTRIBUTING.md",
    CONTRIBUTING.replace("{{project}}", name),
  );
  project.files.set("CODE_OF_CONDUCT.md", CODE_OF_CONDUCT);
  project.files.set(
    "DEVELOPMENT.md",
    DEVELOPMENT.replace(
      "{{test-command}}",
      project.packageJson.scripts.test
        ? "npm run test"
        : "# No test script for this project kind",
    ),
  );
  if (owner) project.files.set(".atlassian/OWNER", `${owner}\n`);
}
