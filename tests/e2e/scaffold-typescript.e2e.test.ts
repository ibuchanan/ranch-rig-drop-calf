import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import ts from "typescript";

// Requires Dagger only; never registers, installs, or deploys a Forge app.
const repo = join(import.meta.dir, "../..");

test("init changeset adopts JS in place, checks it, and update preserves later JS", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_scaffold_"));
  const source = "export const run = () => missingSymbol;\n";
  const frontend = "export const App = () => null;\n";
  const custom = "export default () => null;\n";
  const call = (...args: string[]) =>
    execFileSync(
      "dagger",
      ["--progress", "plain", "call", "-m", repo, ...args],
      { cwd: repo, encoding: "utf8", stdio: "pipe", timeout: 120_000 },
    );
  try {
    mkdirSync(join(root, "src/frontend"), { recursive: true });
    mkdirSync(join(root, "static/app/src"), { recursive: true });
    writeFileSync(join(root, "src/index.js"), source);
    writeFileSync(join(root, "src/frontend/index.jsx"), frontend);
    writeFileSync(join(root, "static/app/src/App.js"), custom);
    writeFileSync(
      join(root, "manifest.yml"),
      "modules:\n  function:\n    - key: main\n      handler: index.run\nresources:\n  - key: main\n    path: src/frontend/index.jsx\n  - key: custom\n    path: static/app/build\napp:\n  runtime:\n    name: nodejs24.x\n",
    );
    call(
      "init-changes",
      "--directory",
      root,
      "--profile",
      "forge-app",
      "--owner",
      "tester",
      "--package-name",
      "sample",
      "export",
      "--path",
      root,
    );
    expect(existsSync(join(root, "src/index.js"))).toBe(false);
    expect(existsSync(join(root, "src/frontend/index.jsx"))).toBe(false);
    expect(readFileSync(join(root, "src/index.ts"), "utf8")).toBe(source);
    expect(readFileSync(join(root, "src/frontend/index.tsx"), "utf8")).toBe(
      frontend,
    );
    expect(readFileSync(join(root, "static/app/src/App.js"), "utf8")).toBe(
      custom,
    );
    const manifest = readFileSync(join(root, "manifest.yml"), "utf8");
    expect(manifest).toContain("path: src/frontend/index.tsx");
    expect(manifest).toContain("path: static/app/build");
    for (const path of ["tsconfig.json", "tsconfig.typecheck.json"]) {
      const parsed = ts.getParsedCommandLineOfConfigFile(
        join(root, path),
        {},
        {
          ...ts.sys,
          onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
            throw new Error(
              ts.flattenDiagnosticMessageText(diagnostic.messageText, " "),
            );
          },
        },
      );
      expect(parsed?.fileNames).toContain(join(root, "src/index.ts"));
      const program = ts.createProgram(
        parsed?.fileNames ?? [],
        parsed?.options ?? {},
      );
      expect(
        ts
          .getPreEmitDiagnostics(program)
          .some(
            (diagnostic) =>
              diagnostic.code === 2304 &&
              diagnostic.file?.fileName === join(root, "src/index.ts"),
          ),
      ).toBe(true);
    }
    writeFileSync(join(root, "src/later.js"), "export const later = 1;\n");
    call(
      "update",
      "--directory",
      root,
      "--profile",
      "forge-app",
      "export",
      "--path",
      root,
    );
    expect(readFileSync(join(root, "src/later.js"), "utf8")).toBe(
      "export const later = 1;\n",
    );
    expect(existsSync(join(root, "src/later.ts"))).toBe(false);
    expect(readFileSync(join(root, "manifest.yml"), "utf8")).toBe(manifest);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
