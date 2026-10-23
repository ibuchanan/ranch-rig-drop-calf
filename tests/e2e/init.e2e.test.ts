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

// Requires Dagger, but never registers, installs, or deploys a Forge app.
const repo = join(import.meta.dir, "../..");

/** What `init` must produce for one project kind, beyond what every kind gets. */
type Expected = {
  runtime: "node" | "bun";
  /** Node major written to .nvmrc and @types/node; Bun kinds have neither. */
  nodeMajor?: string;
  /** Whether AGENTS.md is seeded, and from which template when its text is fixed. */
  agents: { seeded: boolean; template?: string };
  fallow: boolean;
  /** Whether the kind seeds the promptfoo eval suite under `--preset all`. */
  evals: boolean;
  /** Whether the kind seeds source files, such as a starter skill's scripts. */
  seedsSource: boolean;
  sizeCheck: boolean;
  /** The build script, or undefined when the kind has none. */
  build?: string;
};

const PROFILES: Record<string, Expected> = {
  library: {
    runtime: "node",
    nodeMajor: "22",
    agents: { seeded: true, template: "templates/aidev/library/AGENTS.md" },
    fallow: true,
    evals: false,
    seedsSource: false,
    sizeCheck: false,
    build: "sh scripts/build.sh",
  },
  "forge-app": {
    runtime: "node",
    nodeMajor: "24",
    agents: { seeded: true },
    fallow: false,
    evals: true,
    seedsSource: false,
    sizeCheck: true,
    build: "tsc --project tsconfig.json",
  },
  tool: {
    runtime: "bun",
    agents: { seeded: false },
    fallow: true,
    evals: false,
    seedsSource: false,
    sizeCheck: false,
    build: "bun build --compile ./src/index.ts --outfile ./dist/cli",
  },
  "agent-skill": {
    runtime: "bun",
    agents: { seeded: true },
    fallow: false,
    evals: true,
    seedsSource: true,
    sizeCheck: false,
  },
};

const cases = Object.keys(PROFILES).flatMap((profile) =>
  [undefined, "all"].map((preset) => ({
    profile,
    preset,
    label: preset ?? "default",
  })),
);

/** Files every kind seeds, whatever its runtime or preset. */
const COMMON_FILES = [
  "LICENSE",
  "catalog-info.yaml",
  "README.md",
  ".gitignore",
  "biome.jsonc",
  "tsconfig.json",
  "cliff.toml",
  ".cspell.jsonc",
  ".markdownlint-cli2.jsonc",
  "DEVELOPMENT.md",
  "docs",
  "specs",
];

/** Run a Dagger `init` or `init-changes` over `directory`, exporting the result to `exportTo`. */
function initialize(
  operation: string,
  directory: string,
  exportTo: string,
  profile: string,
  preset: string | undefined,
) {
  return execFileSync(
    "dagger",
    [
      "--progress",
      "plain",
      "call",
      "-m",
      repo,
      operation,
      "--directory",
      directory,
      "--profile",
      profile,
      "--owner",
      "tester",
      "--package-name",
      "sample",
      ...(preset ? ["--preset", preset] : []),
      "export",
      "--path",
      exportTo,
    ],
    { cwd: repo, encoding: "utf8", timeout: 120_000, stdio: "pipe" },
  );
}

/** Which optional paths the exported project must (true) or must not (false) contain. */
function presence(expected: Expected, preset: string | undefined) {
  const node = expected.runtime === "node";
  return {
    ".nvmrc": node,
    ".npmrc": node,
    "bunfig.toml": !node,
    "AGENTS.md": expected.agents.seeded,
    ".fallowrc.jsonc": expected.fallow,
    "promptfooconfig.yaml": expected.evals && preset === "all",
    src: expected.seedsSource,
    "manifest.yml": false,
  };
}

function expectProject(
  output: string,
  profile: string,
  expected: Expected,
  preset: string | undefined,
) {
  const read = (path: string) => readFileSync(join(output, path), "utf8");
  const pkg = JSON.parse(read("package.json"));
  expect(pkg).toMatchObject({
    name: "sample",
    author: "tester",
    description: "",
    private: true,
  });
  expect(pkg.engines).toBeUndefined();
  expect(pkg.scripts.build).toBe(expected.build);
  expect(Boolean(pkg.scripts["size:check"])).toBe(expected.sizeCheck);
  expect(Boolean(pkg.scripts.todo)).toBe(true);
  expect(Boolean(pkg.scripts["lint:docs"])).toBe(true);
  expect(read(".atlassian/OWNER")).toBe("tester");

  for (const path of COMMON_FILES)
    expect(existsSync(join(output, path)), path).toBe(true);
  for (const [path, wanted] of Object.entries(presence(expected, preset)))
    expect(existsSync(join(output, path)), `${profile}: ${path}`).toBe(wanted);

  if (expected.runtime === "bun") {
    expect(read("bunfig.toml")).toContain("bun = true");
    expect(pkg.packageManager).toMatch(/^bun@\d+\.\d+\.\d+$/);
    expect(pkg.devDependencies["@types/node"]).toBeUndefined();
  } else {
    expect(read(".nvmrc")).toBe(`${expected.nodeMajor}\n`);
    expect(pkg.devDependencies["@types/node"]).toBe(expected.nodeMajor);
  }
  if (expected.agents.template)
    expect(read("AGENTS.md")).toBe(
      readFileSync(join(repo, expected.agents.template), "utf8"),
    );
}

/**
 * A rerun is refused while either one-time marker remains, and owner files
 * are never touched. Removing catalog-info.yaml leaves only the OWNER marker.
 */
const MARKER_SCENARIOS = [
  { marker: "catalog-info.yaml", remove: [] },
  { marker: ".atlassian/OWNER", remove: ["catalog-info.yaml"] },
];

function expectRerunsRefused(
  output: string,
  profile: string,
  preset: string | undefined,
) {
  const ownerFiles = new Map([
    ["README.md", "# Owner-written README\n"],
    ["AGENTS.md", "# Owner-written guidance\n"],
    ["tsconfig.json", "// Owner compiler settings\n{}\n"],
  ]);
  for (const [path, contents] of ownerFiles)
    writeFileSync(join(output, path), contents);
  for (const path of ["package.json", "catalog-info.yaml", ".atlassian/OWNER"])
    ownerFiles.set(path, readFileSync(join(output, path), "utf8"));
  for (const { marker, remove } of MARKER_SCENARIOS) {
    for (const path of remove) {
      rmSync(join(output, path));
      ownerFiles.delete(path);
    }
    for (const operation of ["init", "init-changes"]) {
      expect(() =>
        initialize(operation, output, output, profile, preset),
      ).toThrow(`${marker} already exists; use update instead`);
      for (const [path, contents] of ownerFiles)
        expect(readFileSync(join(output, path), "utf8"), path).toBe(contents);
      expect(existsSync(join(output, "catalog-info.yaml"))).toBe(
        marker === "catalog-info.yaml",
      );
    }
  }
}

test.each(cases)(
  "$profile init-changes exports once and both init forms refuse reruns ($label)",
  ({ profile, preset }) => {
    const expected = PROFILES[profile];
    if (!expected) throw new Error(`No expectations for ${profile}`);
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_init_"));
    const input = join(root, "empty");
    const output = join(root, "new-project");
    try {
      mkdirSync(input);
      expect(existsSync(output)).toBe(false);
      initialize("init-changes", input, output, profile, preset);
      expectProject(output, profile, expected, preset);
      expect(existsSync(join(input, "package.json"))).toBe(false);
      expectRerunsRefused(output, profile, preset);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
