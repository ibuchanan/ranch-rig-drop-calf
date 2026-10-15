import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { forgeRuntimeFromNvmrc } from "../../src/capabilities/forge-manifest.ts";
import { NODE_NVMRC, NPMRC } from "../../src/capabilities/node.ts";
import { resolveProfile } from "../../src/composition/profiles.ts";
import { assemblePackage } from "../../src/core/package-json.ts";

const NODE_FORGE_RUNTIME = forgeRuntimeFromNvmrc(NODE_NVMRC);

// Requires a Dagger engine, but never registers or deploys a Forge app.
const repo = join(import.meta.dir, "../..");

function daggerCall(...args: string[]): string {
  return execFileSync(
    "dagger",
    ["--progress", "plain", "call", "-m", repo, ...args],
    {
      cwd: repo,
      encoding: "utf8",
      timeout: 240_000,
      stdio: "pipe",
      env: { ...process.env, DAGGER_NO_NAG: "1" },
    },
  );
}

// Recursively snapshot directory, handling nested .atlassian subdirectories.
const snapshot = (directory: string): [string, string][] => {
  const result: [string, string][] = [];
  const walk = (dir: string, prefix = "") => {
    readdirSync(dir)
      .sort()
      .forEach((name) => {
        const path = join(dir, name);
        const relPath = prefix ? `${prefix}/${name}` : name;
        const stat = statSync(path);
        if (stat.isDirectory()) {
          walk(path, relPath);
        } else {
          result.push([relPath, readFileSync(path, "utf8")]);
        }
      });
  };
  walk(directory);
  return result;
};

for (const kind of ["library", "forge-app"]) {
  test(`Dagger ${kind} update reconciles owner edits and is idempotent`, () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_node_update_"));
    const input = join(root, "input");
    const output = join(root, "output");
    try {
      mkdirSync(input);
      const pkg = {
        name: "sample",
        author: "tester",
        type: "module",
        private: true,
        license: "Apache-2.0",
        engines: { node: ">=20", npm: ">=10" },
        devDependencies: { "@types/node": "^24.0.0" },
        dependencies: { kept: "1.0.0" },
        scripts: { custom: "echo kept" },
      };
      const manifest =
        "app:\n  id: example\n  runtime:\n    name: 'nodejs22.x' # pin\n    memoryMB: 512\n";
      writeFileSync(join(input, "package.json"), JSON.stringify(pkg));
      writeFileSync(
        join(input, "catalog-info.yaml"),
        "apiVersion: backstage.io/v1alpha1\nkind: Component\nmetadata:\n  name: sample\n  title: Sample Project\n  annotations:\n    forge-ranch/package-name: sample\n    forge-ranch/license: Apache-2.0\n    forge-ranch/copyright-date: '2025'\nspec:\n  type: " +
          kind +
          "\n  lifecycle: experimental\n  owner: user:default/tester\n",
      );
      writeFileSync(join(input, "manifest.yml"), manifest);
      writeFileSync(join(input, ".nvmrc"), "22\n");
      writeFileSync(
        join(input, ".npmrc"),
        "@acme:registry=https://example.invalid/\n",
      );
      writeFileSync(join(input, "owner.txt"), "kept\n");
      writeFileSync(join(input, "README.md"), "# An authored project README\n");
      mkdirSync(join(input, ".atlassian"));
      writeFileSync(join(input, ".atlassian/OWNER"), "direct-owner-edit");
      for (const path of [
        "LICENSE",
        "CONTRIBUTING.md",
        "CODE_OF_CONDUCT.md",
        "SECURITY.md",
      ])
        writeFileSync(join(input, path), `owner-edited ${path}\n`);
      const before = snapshot(input);
      daggerCall(
        "update",
        "--directory",
        input,
        "--profile",
        kind,
        "export",
        "--path",
        output,
      );
      const { engines: _engines, ...withoutEngines } = pkg;
      const { policy } = assemblePackage(resolveProfile(kind));
      expect(
        JSON.parse(readFileSync(join(output, "package.json"), "utf8")),
      ).toEqual({
        ...(kind === "forge-app" ? withoutEngines : pkg),
        // Seeded dependencies the owner still declares are kept fresh; removed ones stay removed.
        devDependencies: {
          "@types/node": kind === "library" ? "22" : "^24.0.0",
        },
        scripts: { ...pkg.scripts, ...policy.scripts },
      });
      expect(readFileSync(join(output, ".atlassian/OWNER"), "utf8")).toBe(
        "tester",
      );
      expect(readFileSync(join(output, "README.md"), "utf8")).toBe(
        "# An authored project README\n",
      );
      expect(readFileSync(join(output, "catalog-info.yaml"), "utf8")).toBe(
        readFileSync(join(input, "catalog-info.yaml"), "utf8"),
      );
      for (const path of [
        "LICENSE",
        "CONTRIBUTING.md",
        "CODE_OF_CONDUCT.md",
        "SECURITY.md",
      ]) {
        const template = readFileSync(
          join(repo, "vendor/oss-templates", path),
          "utf8",
        );
        expect(readFileSync(join(output, path), "utf8")).toBe(
          template
            .replaceAll("[YYYY]", "2025")
            .replaceAll("[Project name]", "Sample Project"),
        );
      }
      expect(readFileSync(join(output, ".nvmrc"), "utf8")).toBe(
        kind === "library" ? "22\n" : NODE_NVMRC,
      );
      expect(readFileSync(join(output, ".npmrc"), "utf8")).toBe(NPMRC);
      expect(readFileSync(join(output, "manifest.yml"), "utf8")).toBe(
        kind === "forge-app"
          ? manifest.replace("nodejs22.x", NODE_FORGE_RUNTIME)
          : manifest,
      );
      expect(readFileSync(join(output, "owner.txt"), "utf8")).toBe("kept\n");
      expect(
        daggerCall(
          "update",
          "--directory",
          output,
          "--profile",
          kind,
          "changes",
          "--from",
          output,
          "is-empty",
        ).trim(),
      ).toBe("true");
      expect(snapshot(input)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
}

for (const { version, status } of [
  { version: NODE_NVMRC, status: "validated" },
  { version: "22\n", status: "validated" },
  { version: "999999\n", status: "failed" },
  { version: undefined, status: "skipped" },
]) {
  test(`Dagger fnm ${status}: ${JSON.stringify(version)} is read-only`, () => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_node_validate_"));
    try {
      if (version !== undefined) writeFileSync(join(root, ".nvmrc"), version);
      writeFileSync(join(root, ".node-version"), "999999\n");
      writeFileSync(
        join(root, "package.json"),
        '{"engines":{"node":"999999"},"devDependencies":{"@types/node":"24"}}',
      );
      writeFileSync(
        join(root, ".npmrc"),
        "registry=https://example.invalid/\n",
      );
      writeFileSync(join(root, "manifest.yml"), "app: [broken\n");
      writeFileSync(join(root, "owner.txt"), "kept\n");
      const before = snapshot(root);
      const report = JSON.parse(
        daggerCall("validate", "--directory", root, "--profile", "agent-skill"),
      );
      const node = report.find(
        (entry: { capability: string }) => entry.capability === "node",
      );
      expect(node.status).toBe(status);
      if (status === "failed") expect(node.reason).toContain("999999");
      if (status === "skipped") expect(node.reason).toContain(".nvmrc");
      expect(snapshot(root)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 300_000);
}

test("Dagger init normalizes a scaffold manifest without changing other settings", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_node_"));
  const scaffold = join(root, "scaffold");
  const output = join(root, "output");
  try {
    mkdirSync(scaffold);
    writeFileSync(
      join(scaffold, "package.json"),
      '{"name":"sample","engines":{"node":">=22","npm":">=10"}}\n',
    );
    writeFileSync(
      join(scaffold, "manifest.yml"),
      `# Scaffold
modules: {}
app:
  id: 'example' # registration
  runtime:
    name: "nodejs22.x" # scaffold runtime
    memoryMB: 512
    architecture: arm64
`,
    );
    execFileSync(
      "dagger",
      [
        "--progress",
        "plain",
        "call",
        "-m",
        repo,
        "init",
        "--directory",
        scaffold,
        "--profile",
        "forge-app",
        "--owner",
        "tester",
        "export",
        "--path",
        output,
      ],
      { cwd: repo, encoding: "utf8", timeout: 120_000, stdio: "pipe" },
    );
    expect(
      JSON.parse(readFileSync(join(output, "package.json"), "utf8")).engines,
    ).toBeUndefined();
    expect(
      daggerCall(
        "update",
        "--directory",
        output,
        "--profile",
        "forge-app",
        "changes",
        "--from",
        output,
        "is-empty",
      ).trim(),
    ).toBe("true");
    expect(readFileSync(join(output, "manifest.yml"), "utf8")).toBe(`# Scaffold
modules: {}
app:
  id: 'example' # registration
  runtime:
    name: "${NODE_FORGE_RUNTIME}" # scaffold runtime
    memoryMB: 512
    architecture: arm64
`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 180_000);
