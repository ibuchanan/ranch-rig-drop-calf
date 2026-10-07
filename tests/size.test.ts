import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, planSync } from "../src/sync.ts";

test("library and Forge generate an owned size command and matching bundle budget", () => {
  for (const [kind, budget] of [
    [
      "library",
      { name: "Library bundle", path: "dist/index.js", limit: "10 kB" },
    ],
    [
      "forge-app",
      { name: "Forge app bundle", path: "dist/**/*.js", limit: "10 kB" },
    ],
  ] as const) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.size).toBe("npm run build && size-limit");
    expect(packageJson.devDependencies["size-limit"]).toBeDefined();
    expect(packageJson.devDependencies["@size-limit/file"]).toBeDefined();
    expect(packageJson["size-limit"]).toEqual([budget]);
  }
  for (const kind of ["tool", "agent-skill"]) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.size).toBeUndefined();
    expect(packageJson.devDependencies["size-limit"]).toBeUndefined();
    expect(packageJson.devDependencies["@size-limit/file"]).toBeUndefined();
    expect(packageJson["size-limit"]).toBeUndefined();
  }
});

test("sync adds only its named budget and preserves unrelated rules", () => {
  const unrelated = {
    name: "Vendor assets",
    path: "assets/*.js",
    limit: "50 kB",
  };
  const files = new Map([
    [
      "package.json",
      JSON.stringify({ name: "sample", "size-limit": [unrelated] }),
    ],
  ]);
  const plan = planSync(files, "forge-app", "tester");
  expect(plan.operations.filter(({ key }) => key === "size-limit")).toEqual([
    expect.objectContaining({ path: "package.json", mode: "structured-merge" }),
  ]);
  const result = applySync(plan).files;
  expect(JSON.parse(result.get("package.json") ?? "{}")["size-limit"]).toEqual([
    unrelated,
    { name: "Forge app bundle", path: "dist/**/*.js", limit: "10 kB" },
  ]);
  expect(planSync(result, "forge-app", "tester").operations).toEqual([]);
});

test("equal named budget is a no-op while an incompatible one conflicts before mutation", () => {
  const budget = {
    name: "Forge app bundle",
    path: "dist/**/*.js",
    limit: "10 kB",
  };
  const unrelated = {
    name: "Vendor assets",
    path: "assets/*.js",
    limit: "50 kB",
  };
  const base = applySync(
    planSync(
      new Map([["package.json", JSON.stringify({ name: "sample" })]]),
      "forge-app",
      "tester",
    ),
  ).files;
  const pkg = JSON.parse(base.get("package.json") ?? "{}");
  pkg["size-limit"] = [unrelated, budget];
  const equal = new Map(base).set("package.json", JSON.stringify(pkg));
  expect(planSync(equal, "forge-app", "tester").operations).toEqual([]);
  const conflicting = new Map(equal);
  pkg["size-limit"] = [unrelated, { ...budget, limit: "20 kB" }];
  conflicting.set("package.json", JSON.stringify(pkg));
  expect(() => planSync(conflicting, "forge-app", "tester")).toThrow(
    ConflictError,
  );
  expect(() => planSync(conflicting, "forge-app", "tester")).toThrow(
    /Forge app bundle/,
  );
  expect(conflicting.get("package.json")).toContain('"20 kB"');
});
