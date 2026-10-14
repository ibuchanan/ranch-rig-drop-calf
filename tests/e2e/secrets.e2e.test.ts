import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  FORGE_SECRETS_SCRIPTS,
  SECRETS_EXECUTABLES,
} from "../../src/capabilities/secrets.ts";

const repo = join(import.meta.dir, "../..");

test("Dagger secrets seed, owner edits, executable validation and idempotent update", () => {
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
    const config = `${readFileSync(join(seed, "secretspec.toml"), "utf8")}API_TOKEN = { required = true }\n`;
    const keys = '["API_TOKEN"]\n';
    writeFileSync(join(seed, "secretspec.toml"), config);
    writeFileSync(join(seed, "forge-variable-keys.json"), keys);
    const validate = () =>
      JSON.parse(
        call("validate", "--directory", seed, "--profile", "forge-app"),
      ).find((entry: { capability: string }) => entry.capability === "secrets");
    expect(validate()).toEqual({
      capability: "secrets",
      status: "validated",
    });
    chmodSync(join(seed, SECRETS_EXECUTABLES[0]), 0o644);
    expect(validate()).toMatchObject({
      status: "failed",
      reason: `${SECRETS_EXECUTABLES[0]} is not executable`,
    });
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
        readFileSync(join(directory, "forge-variable-keys.json"), "utf8"),
      ).toBe(keys);
      for (const path of SECRETS_EXECUTABLES)
        expect(statSync(join(directory, path)).mode & 0o777).toBe(0o755);
      expect(
        JSON.parse(readFileSync(join(directory, "package.json"), "utf8"))
          .scripts,
      ).toMatchObject({ ...FORGE_SECRETS_SCRIPTS, custom: "keep" });
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 240_000);
