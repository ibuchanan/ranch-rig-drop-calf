import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";

test("test-capable kinds expose Bun test, watch and coverage commands on an empty starter", () => {
  for (const kind of ["library", "forge-app", "tool"]) {
    const { packageJson, files } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.test).toBe("bun test --pass-with-no-tests");
    expect(packageJson.scripts["test:watch"]).toBe(
      "bun test --watch --pass-with-no-tests",
    );
    expect(packageJson.scripts["test:coverage"]).toBe(
      "bun test --coverage --pass-with-no-tests",
    );
    expect(packageJson.devDependencies.vitest).toBeUndefined();
    expect(files.has("vitest.config.ts")).toBe(false);
  }
  const agent = buildProject("agent-skill", "sample", "tester");
  expect(
    Object.keys(agent.packageJson.scripts).filter((key) =>
      key.startsWith("test"),
    ),
  ).toEqual([]);
});
