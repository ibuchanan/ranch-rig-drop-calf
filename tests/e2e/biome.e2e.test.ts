import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { BIOME_SCRIPTS } from "../../src/biome.ts";
import { GIT_HOOKS_SCRIPTS } from "../../src/git-hooks.ts";
import { TOOL_VERSIONS } from "../../src/versions.ts";

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

function temporaryRoot(): string {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  return mkdtempSync(join(repo, ".scratch/tmp_rovo_biome_e2e_"));
}

const schema = `https://biomejs.dev/schemas/${TOOL_VERSIONS.biome}/schema.json`;

for (const kind of ["library", "tool", "forge-app", "agent-skill"]) {
  test(`Dagger ${kind} Biome init/update is unchanged, then migrates owner edits idempotently`, () => {
    const root = temporaryRoot();
    const input = join(root, "input");
    const initialized = join(root, "initialized");
    const output = join(root, "output");
    try {
      mkdirSync(input);
      daggerCall(
        "init",
        "--directory",
        input,
        "--profile",
        kind,
        "--owner",
        "tester",
        "--package-name",
        "sample",
        "export",
        "--path",
        initialized,
      );
      expect(
        daggerCall(
          "update",
          "--directory",
          initialized,
          "--profile",
          kind,
          "changes",
          "--from",
          initialized,
          "is-empty",
        ).trim(),
      ).toBe("true");
      const editorconfig = "[*]\nindent_style = tab\nindent_size = 4\n";
      const config = `{
 // owner formatting decision
 "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
 "formatter": { "indentStyle": "tab", "lineWidth": 120 },
 "files": { "ignore": ["dist/**"] },
 "linter": { "rules": { "recommended": false } }
}\n`;
      writeFileSync(join(initialized, "biome.jsonc"), config);
      writeFileSync(join(initialized, ".editorconfig"), editorconfig);
      writeFileSync(join(initialized, "owner.ts"), "broken source ((\n");
      const pkg = JSON.parse(
        readFileSync(join(initialized, "package.json"), "utf8"),
      );
      pkg.scripts.format = "owner formatter";
      pkg.scripts.lint = "owner lint";
      pkg.scripts.custom = "echo kept";
      pkg.devDependencies["@biomejs/biome"] = "1.9.4";
      pkg.devDependencies.kept = "1";
      writeFileSync(join(initialized, "package.json"), JSON.stringify(pkg));
      daggerCall(
        "update",
        "--directory",
        initialized,
        "--profile",
        kind,
        "export",
        "--path",
        output,
      );
      const migrated = readFileSync(join(output, "biome.jsonc"), "utf8");
      const parsed = ts.parseConfigFileTextToJson("biome.jsonc", migrated);
      expect(parsed.error).toBeUndefined();
      expect(parsed.config.$schema).toBe(schema);
      expect(parsed.config.formatter).toEqual({
        indentStyle: "tab",
        lineWidth: 120,
      });
      expect(parsed.config.files.includes).toContain("!**/dist/**");
      expect(parsed.config.linter.rules).toEqual({ preset: "none" });
      expect(migrated).toContain("// owner formatting decision");
      expect(readFileSync(join(output, ".editorconfig"), "utf8")).toBe(
        editorconfig,
      );
      expect(readFileSync(join(output, "owner.ts"), "utf8")).toBe(
        "broken source ((\n",
      );
      const updatedPackage = JSON.parse(
        readFileSync(join(output, "package.json"), "utf8"),
      );
      expect(updatedPackage.scripts).toEqual({
        ...pkg.scripts,
        ...BIOME_SCRIPTS,
        ...GIT_HOOKS_SCRIPTS,
      });
      expect(updatedPackage.devDependencies).toEqual({
        ...pkg.devDependencies,
        "@biomejs/biome": TOOL_VERSIONS.biome,
      });
      expect(readFileSync(join(initialized, "biome.jsonc"), "utf8")).toBe(
        config,
      );
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
}

for (const { name, config, base, status } of [
  {
    name: "owner settings and broken source",
    config: `{ "$schema": "${schema}", "formatter": { "indentStyle": "tab" }, "linter": { "rules": { "preset": "none" } } }`,
    status: "validated",
  },
  {
    name: "schema mismatch is not policy failure",
    config: '{"$schema":"https://biomejs.dev/schemas/2.5.13/schema.json"}',
    status: "validated",
  },
  { name: "no schema", config: "{}", status: "validated" },
  {
    name: "valid relative extends",
    config: '{"extends":["./base.jsonc"]}',
    base: '{"formatter":{"indentStyle":"tab"}}',
    status: "validated",
  },
  {
    name: "missing relative extends",
    config: '{"extends":["./missing.jsonc"]}',
    status: "failed",
  },
  {
    name: "invalid extended config",
    config: '{"extends":["./base.jsonc"]}',
    base: '{"formatter":{"indentStyle":"banana"}}',
    status: "failed",
  },
  {
    name: "invalid formatter setting",
    config: '{"formatter":{"indentStyle":"banana"}}',
    status: "failed",
  },
  {
    name: "unknown config key",
    config: '{"notASetting":true}',
    status: "failed",
  },
  { name: "malformed JSONC", config: "{", status: "failed" },
  { name: "missing config", config: undefined, status: "skipped" },
]) {
  test(`Dagger Biome validation: ${name}`, () => {
    const root = temporaryRoot();
    try {
      if (config !== undefined)
        writeFileSync(join(root, "biome.jsonc"), config);
      if (base !== undefined) writeFileSync(join(root, "base.jsonc"), base);
      writeFileSync(join(root, "bad.ts"), "const broken = ((\n");
      writeFileSync(join(root, ".editorconfig"), "[*]\nindent_style = tab\n");
      const report = JSON.parse(
        daggerCall("validate", "--directory", root, "--profile", "tool"),
      );
      const biome = report.find(
        (entry: { capability: string }) => entry.capability === "biome",
      );
      expect(biome.status).toBe(status);
      if (status !== "validated")
        expect(biome.reason.length).toBeGreaterThan(0);
      if (config !== undefined)
        expect(readFileSync(join(root, "biome.jsonc"), "utf8")).toBe(config);
      if (base !== undefined)
        expect(readFileSync(join(root, "base.jsonc"), "utf8")).toBe(base);
      expect(readFileSync(join(root, "bad.ts"), "utf8")).toBe(
        "const broken = ((\n",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 240_000);
}
