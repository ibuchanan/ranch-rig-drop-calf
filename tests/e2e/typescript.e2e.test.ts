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

const repo = join(import.meta.dir, "../..");

function root() {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  return mkdtempSync(join(repo, ".scratch/tmp_rovo_typescript_e2e_"));
}

function call(...args: string[]) {
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

function report(directory: string): { status: string; reason?: string } {
  return JSON.parse(
    call("validate", "--directory", directory, "--profile", "tool"),
  ).find((entry: { capability: string }) => entry.capability === "typescript");
}

for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
  test(`Dagger ${kind} TypeScript init, update, validation and trigger removal`, () => {
    const temporary = root();
    try {
      const input = join(temporary, "input");
      const initialized = join(temporary, "initialized");
      const updated = join(temporary, "updated");
      const reset = join(temporary, "reset");
      mkdirSync(input);
      call(
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
        call(
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
      mkdirSync(join(initialized, "src"));
      // showConfig accepts source with a type error; validation must not compile it.
      writeFileSync(
        join(initialized, "src/index.ts"),
        'export const value: number = "wrong";\n',
      );
      const basePath = join(initialized, "tsconfig.json");
      const base = readFileSync(basePath, "utf8");
      writeFileSync(
        basePath,
        base.replace(
          '"strict": true',
          '"strict": false,\n    "paths": { "@/*": ["src/*"] } /* owner alias */',
        ),
      );
      call(
        "update",
        "--directory",
        initialized,
        "--profile",
        kind,
        "export",
        "--path",
        updated,
      );
      const text = readFileSync(join(updated, "tsconfig.json"), "utf8");
      expect(text).toContain("/* owner alias */");
      const parsed = ts.parseConfigFileTextToJson("tsconfig.json", text).config;
      expect(parsed.compilerOptions.strict).toBe(true);
      expect(parsed.compilerOptions.types).toEqual(["node"]);
      expect(parsed.compilerOptions.paths).toEqual({ "@/*": ["src/*"] });
      expect(parsed.compilerOptions.moduleResolution).toBe(
        kind === "library" ? "Bundler" : "Node",
      );
      expect(
        call(
          "update",
          "--directory",
          updated,
          "--profile",
          kind,
          "changes",
          "--from",
          updated,
          "is-empty",
        ).trim(),
      ).toBe("true");
      expect(report(updated).status).toBe("validated");
      expect(readFileSync(join(updated, "tsconfig.json"), "utf8")).toBe(text);
      const pkgPath = join(updated, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      delete pkg.devDependencies.vitest;
      delete pkg.devDependencies.tsdown;
      writeFileSync(pkgPath, JSON.stringify(pkg));
      call(
        "update",
        "--directory",
        updated,
        "--profile",
        kind,
        "export",
        "--path",
        reset,
      );
      // Update never re-adds removed tool dependencies, so removing the
      // triggers selects the plain compiler policy in every kind.
      const check = ts.parseConfigFileTextToJson(
        "tsconfig.typecheck.json",
        readFileSync(join(reset, "tsconfig.typecheck.json"), "utf8"),
      ).config;
      expect(
        JSON.parse(readFileSync(join(reset, "package.json"), "utf8"))
          .devDependencies,
      ).not.toContainAnyKeys(["vitest", "tsdown"]);
      expect(check.compilerOptions).toMatchObject({
        module: "ESNext",
        moduleResolution: "Node",
        rootDir: ".",
        types: kind === "forge-app" ? ["node"] : ["node", "bun"],
      });
      expect(check.include).toEqual(["src", "test", "tests"]);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 240_000);
}

for (const { name, config, check, base, source = true, status } of [
  {
    name: "accepted non-policy settings and broken source",
    config:
      '{"compilerOptions":{"target":"ES2020","strict":false},"include":["src"]}',
    check: '{"extends":"./tsconfig.json","compilerOptions":{"noEmit":true}}',
    status: "validated",
  },
  {
    name: "unknown compiler option",
    config: '{"compilerOptions":{"notAnOption":true}}',
    check: "{}",
    status: "failed",
  },
  {
    name: "compiler tolerates recoverable base syntax",
    config: "{",
    check: "{}",
    status: "validated",
  },
  {
    name: "compiler tolerates recoverable typecheck syntax",
    config: '{"include":["src"]}',
    check: "{",
    status: "validated",
  },
  {
    name: "relative extends",
    config: '{"extends":"./base.json","include":["src"]}',
    check: '{"extends":"./tsconfig.json"}',
    base: '{"compilerOptions":{"strict":false}}',
    status: "validated",
  },
  {
    name: "missing extends",
    config: '{"extends":"./missing.json"}',
    check: "{}",
    status: "failed",
  },
  {
    name: "empty starter",
    config: '{"include":["src"]}',
    check: '{"extends":"./tsconfig.json"}',
    source: false,
    status: "failed",
  },
  {
    name: "both missing",
    config: undefined,
    check: undefined,
    status: "skipped",
  },
  { name: "partial pair", config: "{}", check: undefined, status: "failed" },
]) {
  test(`Dagger TypeScript validation: ${name}`, () => {
    const temporary = root();
    try {
      if (config !== undefined)
        writeFileSync(join(temporary, "tsconfig.json"), config);
      if (check !== undefined)
        writeFileSync(join(temporary, "tsconfig.typecheck.json"), check);
      if (base !== undefined) writeFileSync(join(temporary, "base.json"), base);
      if (source) {
        mkdirSync(join(temporary, "src"));
        writeFileSync(
          join(temporary, "src/index.ts"),
          'const value: number = "wrong";\n',
        );
      }
      const result = report(temporary);
      expect(result.status, result.reason).toBe(status);
      if (status !== "validated")
        expect(result.reason?.length ?? 0).toBeGreaterThan(0);
      if (config !== undefined)
        expect(readFileSync(join(temporary, "tsconfig.json"), "utf8")).toBe(
          config,
        );
      if (check !== undefined)
        expect(
          readFileSync(join(temporary, "tsconfig.typecheck.json"), "utf8"),
        ).toBe(check);
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  }, 240_000);
}
