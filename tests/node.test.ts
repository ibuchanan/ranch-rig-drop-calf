import { describe, expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { applySync, ConflictError, ParseError, planSync } from "../src/sync.ts";
import { NODE_FORGE_RUNTIME, NPM_REGISTRY, NPMRC } from "../src/node.ts";

const packageJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ name: "sample", ...extra });

const plan = (
  files: Map<string, string>,
  profile: string,
): ReturnType<typeof planSync> =>
  planSync(
    new Map<string, string>([["package.json", packageJson()], ...files]),
    profile,
    "tester",
  );

describe("node baseline", () => {
  test.each(["library", "forge-app", "tool", "agent-skill"])(
    "%s pins one Node baseline across package.json, .nvmrc and .npmrc",
    (kind) => {
      const { packageJson: pkg, files } = buildProject(
        kind,
        "sample",
        "tester",
      );
      expect(files.get(".nvmrc")).toBe("24\n");
      expect(files.get(".npmrc")).toBe(NPMRC);
      expect(pkg.engines).toEqual({ node: "24.x" });
      expect(pkg.devDependencies["@types/node"]).toBe("24");
    },
  );

  test("never authors a manifest.yml; the Forge runtime is reconciled instead", () => {
    for (const kind of ["forge-app", "tool", "library", "agent-skill"])
      expect(
        buildProject(kind, "sample", "tester").files.has("manifest.yml"),
      ).toBe(false);
    expect(
      planSync(
        new Map([["package.json", packageJson()]]),
        "forge-app",
        "tester",
      ).operations.some((operation) => operation.path === "manifest.yml"),
    ).toBe(false);
  });
});

describe(".npmrc is an owned key", () => {
  test("seeds the public registry when absent", () => {
    expect(plan(new Map(), "tool").operations).toContainEqual({
      path: ".npmrc",
      key: "registry",
      mode: "create-if-absent",
      before: undefined,
      after: NPMRC,
    });
  });

  test("adds the registry to an existing file without disturbing user lines", () => {
    const existing = "# keep me\n@acme:registry=https://acme.example/\n";
    const result = applySync(
      plan(new Map([[".npmrc", existing]]), "tool"),
    ).files;
    expect(result.get(".npmrc")).toBe(
      `# keep me\n@acme:registry=https://acme.example/\nregistry=${NPM_REGISTRY}\n`,
    );
  });

  test("is a no-op once the registry matches", () => {
    expect(
      plan(new Map([[".npmrc", NPMRC]]), "tool").operations.filter(
        (operation) => operation.path === ".npmrc",
      ),
    ).toEqual([]);
  });

  test("a different registry is a conflict that leaves the input untouched", () => {
    const existing = "registry=https://npm.internal.example/\n";
    for (const kind of ["library", "forge-app", "tool", "agent-skill"]) {
      const files = new Map([[".npmrc", existing]]);
      expect(() => plan(files, kind)).toThrow(ConflictError);
      expect(() => plan(files, kind)).toThrow(/npm\.internal/);
      expect(files.get(".npmrc")).toBe(existing);
    }
  });
});

describe("Forge runtime reconciliation", () => {
  const manifest = (body: string) =>
    `app:\n  id: ari:cloud:ecosystem::app/abc\n${body}`;

  test("adds app.runtime.name while preserving the rest of the manifest", () => {
    const existing =
      "# keep me\napp:\n  id: ari:cloud:ecosystem::app/abc\nmodules:\n  function:\n    - key: copy\n";
    const result = applySync(
      plan(new Map([["manifest.yml", existing]]), "forge-app"),
    ).files;
    const after = result.get("manifest.yml") ?? "";
    expect(after).toContain(`name: ${NODE_FORGE_RUNTIME}`);
    expect(after).toContain("# keep me");
    expect(after).toContain("key: copy");
    expect(after).toContain("ari:cloud:ecosystem::app/abc");
  });

  test("fills in a runtime name when the key is absent but siblings exist", () => {
    const result = applySync(
      plan(
        new Map([
          [
            "manifest.yml",
            manifest("  runtime:\n    environment: production\n"),
          ],
        ]),
        "forge-app",
      ),
    ).files;
    expect(result.get("manifest.yml")).toContain(`name: ${NODE_FORGE_RUNTIME}`);
  });

  test("is a no-op when the runtime already matches", () => {
    const existing = manifest(`  runtime:\n    name: ${NODE_FORGE_RUNTIME}\n`);
    expect(
      plan(
        new Map([["manifest.yml", existing]]),
        "forge-app",
      ).operations.filter((operation) => operation.path === "manifest.yml"),
    ).toEqual([]);
  });

  test("a different runtime is a conflict", () => {
    const existing = manifest("  runtime:\n    name: nodejs22.x\n");
    expect(() =>
      plan(new Map([["manifest.yml", existing]]), "forge-app"),
    ).toThrow(ConflictError);
    expect(() =>
      plan(new Map([["manifest.yml", existing]]), "forge-app"),
    ).toThrow(/nodejs22\.x/);
  });

  test("is skipped entirely for kinds that are not Forge apps", () => {
    for (const kind of ["library", "tool", "agent-skill"])
      expect(
        plan(
          new Map([["manifest.yml", manifest("  runtime: {}\n")]]),
          kind,
        ).operations.filter((operation) => operation.path === "manifest.yml"),
      ).toEqual([]);
  });

  test("an unparseable manifest is reported before anything is written", () => {
    const files = new Map([["manifest.yml", "app:\n  - [unclosed\n"]]);
    expect(() => plan(files, "forge-app")).toThrow(ParseError);
    expect(files.get("manifest.yml")).toBe("app:\n  - [unclosed\n");
  });
});

test("node-owned keys converge on a second pass", () => {
  const files = new Map([
    ["package.json", packageJson({ engines: { bun: ">=1" } })],
    ["manifest.yml", "modules: {}\n"],
  ]);
  const first = applySync(planSync(files, "forge-app", "tester")).files;
  expect(planSync(first, "forge-app", "tester").operations).toEqual([]);
});
