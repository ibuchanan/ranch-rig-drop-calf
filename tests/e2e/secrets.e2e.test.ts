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
import { FORGE_SECRETS_SCRIPTS } from "../../src/capabilities/secrets.ts";

const repo = join(import.meta.dir, "../..");

test("Dagger secrets seed, owner edits, validation and idempotent update", () => {
  mkdirSync(join(repo, ".scratch"), { recursive: true });
  const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_secrets_e2e_"));
  const call = (...args: string[]) =>
    execFileSync("dagger", ["--progress", "plain", "call", ...args], {
      cwd: repo,
      encoding: "utf8",
      timeout: 240_000,
      stdio: "pipe",
      env: { ...process.env, DAGGER_NO_NAG: "1" },
    });
  try {
    const empty = join(root, "empty");
    const seed = join(root, "seed");
    const first = join(root, "first");
    const second = join(root, "second");
    mkdirSync(empty);
    call(
      "init",
      "--directory",
      empty,
      "--profile",
      "forge-app",
      "--owner",
      "tester",
      "--package-name",
      "sample",
      "export",
      "--path",
      seed,
    );
    expect(existsSync(join(seed, "scripts/env-var.sh"))).toBe(false);
    expect(existsSync(join(seed, "forge-variable-keys.json"))).toBe(false);
    const config = `${readFileSync(join(seed, "secretspec.toml"), "utf8")}API_TOKEN = { required = true }\n[scopes.runtime]\nsecrets = ["API_TOKEN"]\n`;
    writeFileSync(join(seed, "secretspec.toml"), config);
    const validate = () =>
      JSON.parse(
        call("validate", "--directory", seed, "--profile", "forge-app"),
      ).find((entry: { capability: string }) => entry.capability === "secrets");
    expect(validate()).toEqual({
      capability: "secrets",
      status: "validated",
    });
    writeFileSync(
      join(seed, "secretspec.toml"),
      `${config}[scopes.manifest]\nsecrets = ["MISSING"]\n`,
    );
    expect(validate()).toMatchObject({
      status: "failed",
      reason: expect.stringContaining("not declared"),
    });
    writeFileSync(join(seed, "secretspec.toml"), config);
    writeFileSync(
      join(seed, "package.json"),
      '{"scripts":{"forge:deploy":"old","custom":"keep"}}\n',
    );
    call(
      "update",
      "--directory",
      seed,
      "--profile",
      "forge-app",
      "export",
      "--path",
      first,
    );
    call(
      "update",
      "--directory",
      first,
      "--profile",
      "forge-app",
      "export",
      "--path",
      second,
    );
    execFileSync("diff", ["-qr", first, second], { stdio: "pipe" });
    for (const directory of [first, second]) {
      expect(readFileSync(join(directory, "secretspec.toml"), "utf8")).toBe(
        config,
      );
      expect(
        JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
          .scripts,
      ).toMatchObject({ ...FORGE_SECRETS_SCRIPTS, custom: "keep" });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
