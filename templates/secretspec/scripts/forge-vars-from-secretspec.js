#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

function readKeys() {
  const keys = JSON.parse(
    readFileSync(new URL("../forge-variable-keys.json", import.meta.url), "utf8"),
  );
  if (
    !Array.isArray(keys) ||
    keys.some((key) => typeof key !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) ||
    new Set(keys).size !== keys.length
  ) {
    throw new Error("forge-variable-keys.json must be an array of unique environment-variable names");
  }
  if (keys.some((key) => key.startsWith("FORGE_"))) {
    throw new Error("FORGE_* keys target the CLI and must not be pushed as app variables");
  }
  return keys;
}

function resolveSecretspecEnv(keys) {
  // Return only the selected variables, not the complete injected environment.
  const expression = `JSON.stringify(Object.fromEntries(${JSON.stringify(["FORGE_ENVIRONMENT", ...keys])}.map(key => [key, process.env[key]])))`;
  const output = execFileSync(
    "secretspec",
    [
      "--file",
      fileURLToPath(new URL("../secretspec.toml", import.meta.url)),
      "run",
      "--provider",
      "dotenv",
      "--reason",
      "npm run forge:variables:set",
      "--profile",
      "default",
      "--",
      "node",
      "-p",
      expression,
    ],
    { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(output.trim().split("\n").pop());
}

function main() {
  const keys = readKeys();
  if (keys.length === 0) {
    console.log("No app-level Forge variables declared in forge-variable-keys.json. Add keys there and to secretspec.toml when needed.");
    return;
  }
  const env = resolveSecretspecEnv(keys);
  const environment = env.FORGE_ENVIRONMENT || "development";
  // Preflight all values so a missing key cannot leave a partially updated app.
  for (const key of keys) {
    if (typeof env[key] !== "string" || !env[key]) {
      throw new Error(`Missing value for ${key}; check secretspec.toml`);
    }
  }
  for (const key of keys) {
    execFileSync(
      "forge",
      ["variables", "set", key, env[key], "--environment", environment, "--encrypt"],
      { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
    );
  }
}

try {
  main();
} catch {
  // Child-process errors include commands and captured output, potentially values.
  console.error("Forge variable push failed; check forge-variable-keys.json, secretspec.toml, and Forge authentication.");
  process.exitCode = 1;
}
