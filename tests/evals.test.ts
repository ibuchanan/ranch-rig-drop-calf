import { expect, spyOn, test } from "bun:test";
import { posix } from "node:path";
import { type Directory, dag } from "@dagger.io/dagger";
import { YAML } from "bun";
import { EVALS_TEMPLATE } from "../src/evals.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { mockModuleSource } from "./module-source.ts";
import { promptfooTemplates } from "./templates-source.ts";

test("evals documents a Rovo resource that resolves to the prompt used by every case", () => {
  const files = promptfooTemplates();
  const guide = files.get("docs/how-to/evaluate-rovo-agent.md");
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
  expect(files.get(promptPath)).toContain("translation assistant");

  const cases = YAML.parse(files.get("test/promptfoo-test.yaml") ?? "") as {
    vars: { agent_instructions: string };
  }[];
  expect(cases.length).toBeGreaterThan(0);
  for (const entry of cases)
    expect(entry.vars.agent_instructions).toBe(`file://${promptPath}`);
  expect(files.has("manifest.yml")).toBe(false);
});

test("evals remains a generic translation example without a Rovo agent", () => {
  const files = promptfooTemplates();
  const configText = files.get("promptfooconfig.yaml") ?? "";
  expect(configText).toContain("docs/how-to/evaluate-rovo-agent.md");
  const config = YAML.parse(configText) as {
    prompts: { raw: string }[];
    providers: string[];
    tests: string[];
  };
  expect(config.prompts[0]?.raw).toContain("{{ agent_instructions }}");
  expect(config.providers).toEqual(["google:gemini-2.0-flash-lite"]);
  expect(config.tests).toEqual(["file://test/promptfoo-test.yaml"]);
  const cases = YAML.parse(files.get("test/promptfoo-test.yaml") ?? "") as {
    vars: Record<string, string>;
    assert: { type: string; value: string }[];
  }[];
  for (const entry of cases)
    for (const value of Object.values(entry.vars))
      if (value.startsWith("file://"))
        expect(files.get(value.slice("file://".length))).toBeTruthy();
  expect(cases.map((entry) => entry.assert)).toEqual([
    [{ type: "icontains", value: "Bonjour le monde" }],
    [{ type: "icontains", value: "Dónde está la biblioteca" }],
  ]);
  const guide = files.get("docs/how-to/evaluate-rovo-agent.md") ?? "";
  expect(guide).toContain("without a Rovo agent");
  expect(guide).toContain("GEMINI_API_KEY");
  expect(guide).toContain("npm run eval -- --no-cache");
  expect(guide).toContain("npm run view");
  expect(files.has("manifest.yml")).toBe(false);
});

test("evals marks the shared prompt and leaves manifest wiring to the app owner", () => {
  const files = promptfooTemplates();
  const prompt = files.get("prompts/agent-instructions.md") ?? "";
  expect(prompt).toContain("rovo:agent");
  expect(prompt).toContain("docs/how-to/evaluate-rovo-agent.md");
  const guide = files.get("docs/how-to/evaluate-rovo-agent.md") ?? "";
  expect(guide).toContain("Drop Calf does not edit `manifest.yml`");
  expect(guide).toContain("prompt simulation");
  expect(files.has("manifest.yml")).toBe(false);
});

test("Forge evals selection and all preset declare the same seed tree without authoring its files", () => {
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
  expect(selected.templates).toContain(EVALS_TEMPLATE);
  for (const path of promptfooTemplates().keys())
    expect(selected.files.has(path)).toBe(false);
  expect(selected.files.has("manifest.yml")).toBe(false);

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
  expect(ordinary.templates).not.toContain(EVALS_TEMPLATE);
  expect(ordinary.packageJson.scripts.eval).toBeUndefined();
  expect(ordinary.packageJson.scripts.view).toBeUndefined();
  expect(ordinary.packageJson.devDependencies.promptfoo).toBeUndefined();
});

test("files seeds every Promptfoo byte only when evals is selected", async () => {
  const writes = new Map<string, string>();
  const directory = {
    withNewFile(path: string, content: string) {
      writes.set(path, content);
      return directory;
    },
    withFile(path: string, file: { text: string }) {
      writes.set(path, file.text);
      return directory;
    },
    withDirectory(_path: string, source: { files: Map<string, string> }) {
      for (const [path, content] of source.files) writes.set(path, content);
      return directory;
    },
  } as unknown as Directory;
  const moduleSource = mockModuleSource();
  const stub = spyOn(dag, "directory").mockReturnValue(directory);
  try {
    for (const [withFunctions, withoutFunctions, preset, enabled] of [
      [[], [], undefined, false],
      [["evals"], [], undefined, true],
      [[], [], "all", true],
      [[], ["evals"], "all", false],
    ] as const) {
      writes.clear();
      await new DropCalf().files(
        "forge-app",
        "tester",
        "sample",
        "",
        "",
        [...withFunctions],
        [...withoutFunctions],
        preset,
      );
      for (const [path, content] of promptfooTemplates())
        expect(writes.get(path)).toBe(enabled ? content : undefined);
      expect(writes.has("manifest.yml")).toBe(false);
    }
  } finally {
    stub.mockRestore();
    moduleSource.mockRestore();
  }
});
