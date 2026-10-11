import { expect, test } from "bun:test";
import { posix } from "node:path";
import { YAML } from "bun";
import { buildProject } from "../src/profiles.ts";

test("evals documents a Rovo resource that resolves to the prompt used by every case", () => {
  const project = buildProject("forge-app", "sample", "tester", "", "", [
    "evals",
  ]);
  const guide = project.files.get("docs/how-to/evaluate-rovo-agent.md");
  expect(guide).toBeDefined();
  const snippet = guide?.match(/^[ \t]*```yaml\n([\s\S]*?)^[ \t]*```/m)?.[1];
  expect(snippet).toBeDefined();
  const manifest = YAML.parse(snippet ?? "") as {
    modules: { "rovo:agent": { prompt: string }[] };
    resources: { key: string; path: string }[];
  };
  const prompt = manifest.modules["rovo:agent"][0]?.prompt ?? "";
  const [resourceKey, relativePath] = prompt
    .replace("resource:", "")
    .split(";");
  const resource = manifest.resources.find(({ key }) => key === resourceKey);
  expect(resource).toBeDefined();
  const promptPath = posix.join(resource?.path ?? "", relativePath ?? "");
  expect(promptPath).toBe("prompts/agent-instructions.md");
  expect(project.files.get(promptPath)).toContain("translation assistant");

  const cases = YAML.parse(
    project.files.get("test/promptfoo-test.yaml") ?? "",
  ) as {
    vars: { agent_instructions: string };
  }[];
  expect(cases.length).toBeGreaterThan(0);
  for (const entry of cases)
    expect(entry.vars.agent_instructions).toBe(`file://${promptPath}`);
  expect(project.files.has("manifest.yml")).toBe(false);
});

test("evals remains a generic translation example without a Rovo agent", () => {
  const project = buildProject("forge-app", "sample", "tester", "", "", [
    "evals",
  ]);
  const configText = project.files.get("promptfooconfig.yaml") ?? "";
  expect(configText).toContain("docs/how-to/evaluate-rovo-agent.md");
  const config = YAML.parse(configText) as {
    prompts: { raw: string }[];
    providers: string[];
    tests: string[];
  };
  expect(config.prompts[0]?.raw).toContain("{{ agent_instructions }}");
  expect(config.providers).toEqual(["google:gemini-2.0-flash-lite"]);
  expect(config.tests).toEqual(["file://test/promptfoo-test.yaml"]);
  const cases = YAML.parse(
    project.files.get("test/promptfoo-test.yaml") ?? "",
  ) as {
    vars: Record<string, string>;
    assert: { type: string; value: string }[];
  }[];
  for (const entry of cases)
    for (const value of Object.values(entry.vars))
      if (value.startsWith("file://"))
        expect(project.files.get(value.slice("file://".length))).toBeTruthy();
  expect(cases.map((entry) => entry.assert)).toEqual([
    [{ type: "icontains", value: "Bonjour le monde" }],
    [{ type: "icontains", value: "Dónde está la biblioteca" }],
  ]);
  const guide = project.files.get("docs/how-to/evaluate-rovo-agent.md") ?? "";
  expect(guide).toContain("without a Rovo agent");
  expect(guide).toContain("GEMINI_API_KEY");
  expect(guide).toContain("npm run eval -- --no-cache");
  expect(guide).toContain("npm run view");
  expect(project.files.has("manifest.yml")).toBe(false);
});

test("evals marks the shared prompt and leaves manifest wiring to the app owner", () => {
  const project = buildProject("forge-app", "sample", "tester", "", "", [
    "evals",
  ]);
  const prompt = project.files.get("prompts/agent-instructions.md") ?? "";
  expect(prompt).toContain("rovo:agent");
  expect(prompt).toContain("docs/how-to/evaluate-rovo-agent.md");
  const guide = project.files.get("docs/how-to/evaluate-rovo-agent.md") ?? "";
  expect(guide).toContain("Drop Calf does not edit `manifest.yml`");
  expect(guide).toContain("prompt simulation");
  expect(project.files.has("manifest.yml")).toBe(false);
});

const suitePaths = [
  "docs/how-to/evaluate-rovo-agent.md",
  "promptfooconfig.yaml",
  "prompts/agent-instructions.md",
  "test/promptfoo-test.yaml",
  "test/data/page-1.md",
];

test("Forge evals selection and all preset generate the same complete starter suite", () => {
  const selected = buildProject("forge-app", "sample", "tester", "", "", [
    "evals",
  ]);
  const all = buildProject(
    "forge-app",
    "sample",
    "tester",
    "",
    "",
    [],
    [],
    "all",
  );
  expect(all).toEqual(selected);
  expect(selected.packageJson.scripts).toMatchObject({
    eval: "promptfoo eval",
    view: "promptfoo view",
    test: "vitest run --passWithNoTests",
  });
  expect(selected.packageJson.devDependencies.promptfoo).toBeDefined();
  for (const path of suitePaths) expect(selected.files.get(path)).toBeTruthy();
  expect(selected.files.get("promptfooconfig.yaml")).toContain(
    "file://test/promptfoo-test.yaml",
  );
  expect(selected.files.get("test/promptfoo-test.yaml")).toContain(
    "file://test/data/page-1.md",
  );
  expect(selected.files.get("test/promptfoo-test.yaml")).toContain(
    "file://prompts/agent-instructions.md",
  );

  const ordinary = buildProject("forge-app", "sample", "tester");
  const excluded = buildProject(
    "forge-app",
    "sample",
    "tester",
    "",
    "",
    [],
    ["evals"],
    "all",
  );
  expect(excluded).toEqual(ordinary);
  expect(ordinary.packageJson.scripts.eval).toBeUndefined();
  expect(ordinary.packageJson.scripts.view).toBeUndefined();
  expect(ordinary.packageJson.devDependencies.promptfoo).toBeUndefined();
  for (const path of suitePaths) expect(ordinary.files.has(path)).toBe(false);
});
