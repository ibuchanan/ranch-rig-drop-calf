import type { ProjectBlueprint } from "./project.ts";
import { TOOL_VERSIONS } from "./versions.ts";

const GITLEAKS = `command -v gitleaks >/dev/null 2>&1 || {
  echo "gitleaks not found on PATH. Install it with: brew install gitleaks" >&2
  exit 1
}
gitleaks git --pre-commit --staged`;

export function gitHooks(hasTests: boolean) {
  return {
    addTo(project: ProjectBlueprint) {
      project.packageJson.devDependencies.lefthook = TOOL_VERSIONS.lefthook;
      project.packageJson.scripts.prepare = "lefthook install";
      project.packageJson.scripts.lint = "lefthook run esa-lint";
      project.packageJson.scripts.check = "lefthook run pre-push --force";
      const lint = project.packageJson.scripts["lint:prelint"]
        ? "npm run lint:prelint && npm run lint:check && npm run lint:forge && npm run typecheck"
        : "npm run lint:check && npm run typecheck";
      const lines = [
        "colors: false",
        "output:",
        "  - meta",
        "  - summary",
        "  - failure",
        "",
        "esa-lint:",
        "  commands:",
        "    esa-lint:",
        `      run: ${lint}`,
        "",
        "pre-commit:",
        "  parallel: true",
        "  commands:",
        "    esa-gitleaks:",
        "      run: |",
        ...GITLEAKS.split("\n").map((line) => `        ${line}`),
        "    esa-format:",
        "      run: npm run format",
        "      stage_fixed: true",
        "",
        "pre-push:",
        "  commands:",
        "    esa-format-check:",
        "      run: npm run format:check",
        "    esa-lint:",
        "      run: npm run lint",
        ...(hasTests ? ["    esa-test:", "      run: npm run test"] : []),
      ];
      project.files.set("lefthook.yml", `${lines.join("\n")}\n`);
    },
  };
}
