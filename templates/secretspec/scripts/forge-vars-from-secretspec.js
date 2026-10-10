#!/usr/bin/env node

import { execFileSync } from "node:child_process";

/**
 * App-level runtime secrets to push to Forge via `forge variables set`,
 * matching keys declared under [profiles.default] in secretspec.toml.
 *
 * Empty by default: a generated app has no runtime secrets yet. Add a key here
 * and a matching entry in secretspec.toml when an external source needs a real
 * credential, such as an API token. Every listed value is pushed encrypted.
 */
const APP_VARIABLE_KEYS = [];

function resolveSecretspecEnv() {
  const output = execFileSync(
    "secretspec",
    [
      "run",
      "--provider",
      "dotenv",
      "--reason",
      "npm run forge:variables:set",
      "--",
      "node",
      "-p",
      "JSON.stringify(process.env)",
    ],
    { encoding: "utf8" },
  );
  const lastLine = output.trim().split("\n").pop();
  return JSON.parse(lastLine);
}

function main() {
  if (APP_VARIABLE_KEYS.length === 0) {
    console.log(
      "No app-level Forge variables declared in APP_VARIABLE_KEYS. " +
        "Add a key here and to secretspec.toml when an external source needs " +
        "a real credential.",
    );
    return;
  }

  const env = resolveSecretspecEnv();
  const environment = env.FORGE_ENVIRONMENT || "development";

  for (const key of APP_VARIABLE_KEYS) {
    const value = env[key];
    if (!value) {
      throw new Error(`Missing value for ${key}; check secretspec.toml`);
    }
    execFileSync(
      "forge",
      [
        "variables",
        "set",
        key,
        value,
        "--environment",
        environment,
        "--encrypt",
      ],
      { stdio: "inherit" },
    );
  }
}

main();
