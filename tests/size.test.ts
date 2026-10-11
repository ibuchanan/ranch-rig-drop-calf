import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";

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
