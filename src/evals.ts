import type { Capability } from "./capabilities.ts";
import { TOOL_VERSIONS } from "./versions.ts";

// Versioned starter suite; project-specific instructions and assertions should be edited by its owner.
export const EVAL_ASSETS = new Map([
  [
    "promptfooconfig.yaml",
    `# yaml-language-server: $schema=https://promptfoo.dev/config-schema.json
description: 'Rovo agent translation starter'
prompts:
  - label: Rovo Agent Simulation
    raw: |
      <system>
      {{ agent_instructions }}
      </system>
      <context>
      {{ agent_context }}
      </context>
      <user>
      {{ user_prompt }}
      </user>
providers:
  - google:gemini-2.0-flash-lite
tests:
  - file://test/promptfoo-test.yaml
`,
  ],
  [
    "prompts/agent-instructions.md",
    `You are a helpful translation assistant. Translate the requested context accurately and respond with only the translation.\n`,
  ],
  [
    "test/promptfoo-test.yaml",
    `- description: Translate English to French
  vars:
    agent_instructions: file://prompts/agent-instructions.md
    agent_context: file://test/data/page-1.md
    user_prompt: Translate this context to French
  assert:
    - type: icontains
      value: Bonjour le monde
- description: Translate English to Spanish
  vars:
    agent_instructions: file://prompts/agent-instructions.md
    agent_context: file://test/data/page-2.md
    user_prompt: Translate this context to Spanish
  assert:
    - type: icontains
      value: Dónde está la biblioteca
`,
  ],
  ["test/data/page-1.md", "Hello world\n"],
  ["test/data/page-2.md", "Where is the library?\n"],
]);

export function evals(): Capability {
  return {
    addTo(project) {
      project.packageJson.scripts.eval = "promptfoo eval";
      project.packageJson.scripts.view = "promptfoo view";
      project.packageJson.devDependencies.promptfoo = TOOL_VERSIONS.promptfoo;
      for (const [path, content] of EVAL_ASSETS)
        project.files.set(path, content);
    },
  };
}
