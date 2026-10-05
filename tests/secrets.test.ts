import { expect, test, spyOn } from "bun:test";
import { dag, type Directory } from "@dagger.io/dagger";
import { renderToDirectory } from "../src/project.ts";
import { buildProject } from "../src/profiles.ts";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { applySync, planSync, ConflictError } from "../src/sync.ts";
import { DropCalf } from "../src/index.ts";

test("rendered Forge helper is executable", () => {
  const modes = new Map<string, number | undefined>();
  const directory = {
    withNewFile(
      path: string,
      _content: string,
      options?: { permissions?: number },
    ) {
      modes.set(path, options?.permissions);
      return directory;
    },
  } as unknown as Directory;
  const stub = spyOn(dag, "directory").mockReturnValue(directory);
  try {
    renderToDirectory(buildProject("forge-app", "sample", "", "none"));
    expect(modes.get("scripts/forge-vars-from-secretspec.sh")).toBe(0o755);
  } finally {
    stub.mockRestore();
  }
});

test("doctor reports missing Secretspec and Gitleaks separately without installing", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_doctor_"));
  const path = process.env.PATH;
  try {
    process.env.PATH = root;
    const report = JSON.parse(new DropCalf().doctor("forge-app"));
    expect(report).toContainEqual({ tool: "secretspec", status: "missing" });
    expect(report).toContainEqual({ tool: "gitleaks", status: "missing" });
    writeFileSync(join(root, "secretspec"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(root, "secretspec"), 0o755);
    expect(JSON.parse(new DropCalf().doctor("forge-app"))).toContainEqual({
      tool: "secretspec",
      status: "available",
    });
    expect(JSON.parse(new DropCalf().doctor("tool"))).not.toContainEqual({
      tool: "secretspec",
      status: "missing",
    });
  } finally {
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Forge sync seeds missing secrets files and preserves customized files and scripts", () => {
  const files = new Map([
    ["package.json", '{"name":"sample-app","scripts":{"custom":"echo safe"}}'],
  ]);
  const first = applySync(planSync(files, "forge-app")).files;
  expect(first.get("secretspec.toml")).toContain('name = "sample-app"');
  expect(first.get("scripts/forge-vars-from-secretspec.sh")).toContain(
    "forge variables set",
  );
  expect(JSON.parse(first.get("package.json") ?? "").scripts.custom).toBe(
    "echo safe",
  );
  expect(planSync(first, "forge-app").operations).toEqual([]);
  first.set("secretspec.toml", "# custom config\n");
  first.set("scripts/forge-vars-from-secretspec.sh", "#!/bin/sh\n# custom\n");
  expect(planSync(first, "forge-app").operations).toEqual([]);
  expect(first.get("secretspec.toml")).toBe("# custom config\n");
  const conflicting = new Map(files);
  conflicting.set(
    "package.json",
    '{"name":"sample-app","scripts":{"forge:deploy":"custom deploy"}}',
  );
  expect(() => planSync(conflicting, "forge-app")).toThrow(ConflictError);
  expect(conflicting.size).toBe(1);
});

test("generated helper pushes only configured non-FORGE variables and hides values", () => {
  const root = mkdtempSync(join(process.cwd(), "tmp_rovo_secrets_"));
  try {
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "bin"));
    const project = buildProject("forge-app", "sample", "", "none");
    writeFileSync(
      join(root, "secretspec.toml"),
      `${project.files.get("secretspec.toml")}\nAPI_SECRET = { required = true }\nPUBLIC_KEY = { required = true }\n[profiles.other]\nUNLISTED = { required = true }\n`,
    );
    const script = join(root, "scripts/forge-vars-from-secretspec.sh");
    writeFileSync(
      script,
      project.files.get("scripts/forge-vars-from-secretspec.sh") ?? "",
    );
    chmodSync(script, 0o755);
    writeFileSync(
      join(root, "bin/forge"),
      '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALLS"\necho "CLI echoes sensitive-value" >&2\n',
    );
    chmodSync(join(root, "bin/forge"), 0o755);
    const output = execFileSync(script, [], {
      env: {
        ...process.env,
        PATH: `${join(root, "bin")}:${process.env.PATH}`,
        CALLS: join(root, "calls"),
        FORGE_ENVIRONMENT: "staging",
        FORGE_SITE: "example.atlassian.net",
        API_SECRET: "sensitive-value",
        PUBLIC_KEY: "public-value",
      },
      encoding: "utf8",
    });
    expect(output).not.toContain("sensitive-value");
    const calls = readFileSync(join(root, "calls"), "utf8").trim().split("\n");
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("--encrypt API_SECRET sensitive-value");
    expect(calls[1]).toContain("--environment staging PUBLIC_KEY public-value");
    expect(calls.join("\n")).not.toContain("FORGE_SITE");
    writeFileSync(
      join(root, "bin/forge"),
      '#!/bin/sh\necho "sensitive-value" >&2\nexit 1\n',
    );
    try {
      execFileSync(script, [], {
        env: {
          ...process.env,
          PATH: `${join(root, "bin")}:${process.env.PATH}`,
          FORGE_ENVIRONMENT: "staging",
          API_SECRET: "sensitive-value",
          PUBLIC_KEY: "public-value",
        },
        encoding: "utf8",
      });
      throw new Error("expected helper to fail");
    } catch (error) {
      const failed = error as { stderr?: string; message: string };
      expect(failed.stderr).toContain("Failed to push variable: API_SECRET");
      expect(failed.stderr).not.toContain("sensitive-value");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Forge generation configures project-specific Secretspec and delayed Forge argument expansion", () => {
  const project = buildProject("forge-app", "sample-app", "", "none");
  expect(project.files.get("secretspec.toml")).toContain('name = "sample-app"');
  for (const name of ["FORGE_SITE", "FORGE_PRODUCT", "FORGE_ENVIRONMENT"])
    expect(project.files.get("secretspec.toml")).toContain(name);
  expect(project.files.get("scripts/forge-vars-from-secretspec.sh")).toContain(
    "forge variables set",
  );
  const scripts = project.packageJson.scripts;
  for (const key of [
    "forge:deploy",
    "forge:install",
    "forge:uninstall",
    "forge:upgrade",
    "forge:variables:set",
    "forge:variables:set-encrypted",
  ])
    expect(scripts[key]).toContain("secretspec run -- sh -c '");
  expect(scripts["forge:install"]).toContain('"$FORGE_SITE"');
  expect(scripts["forge:variables:set:secretspec"]).toContain(
    "scripts/forge-vars-from-secretspec.sh",
  );
});
