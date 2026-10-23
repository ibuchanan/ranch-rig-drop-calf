#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// Each rule is [breaks, message]; the first broken rule is reported.
const KEY_RULES = [
  [
    (keys) =>
      !Array.isArray(keys) ||
      keys.some((key) => typeof key !== "string" || !VARIABLE_NAME.test(key)) ||
      new Set(keys).size !== keys.length,
    "forge-variable-keys.json must be an array of unique environment-variable names",
  ],
  [
    (keys) => keys.some((key) => key.startsWith("FORGE_")),
    "FORGE_* keys target the CLI and must not be pushed as app variables",
  ],
];

function readKeys() {
  const keys = JSON.parse(
    readFileSync(new URL("../forge-variable-keys.json", import.meta.url), "utf8"),
  );
  const broken = KEY_RULES.find(([breaks]) => breaks(keys));
  if (broken) throw new Error(broken[1]);
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

const hasValue = (value) => typeof value === "string" && value !== "";

function setVariable(key, value, environment) {
  execFileSync(
    "forge",
    ["variables", "set", key, value, "--environment", environment, "--encrypt"],
    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
  );
}

// Preflight all values so a missing key cannot leave a partially updated app.
function requireValues(keys, env) {
  const missing = keys.find((key) => !hasValue(env[key]));
  if (missing !== undefined) throw new Error(`Missing value for ${missing}; check secretspec.toml`);
}

function main() {
  const keys = readKeys();
  if (keys.length === 0) {
    console.log("No app-level Forge variables declared in forge-variable-keys.json. Add keys there and to secretspec.toml when needed.");
    return;
  }
  const env = resolveSecretspecEnv(keys);
  requireValues(keys, env);
  const environment = env.FORGE_ENVIRONMENT || "development";
  for (const key of keys) setVariable(key, env[key], environment);
}

try {
  main();
} catch {
  // Child-process errors include commands and captured output, potentially values.
  console.error("Forge variable push failed; check forge-variable-keys.json, secretspec.toml, and Forge authentication.");
  process.exitCode = 1;
}
