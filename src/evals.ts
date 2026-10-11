import type { Capability } from "./capabilities.ts";
import { TOOL_VERSIONS } from "./versions.ts";

// Versioned starter suite; project-specific instructions and assertions should be edited by its owner.
export const EVAL_ASSETS = new Map([
  [
    "promptfooconfig.yaml",
    `# yaml-language-server: $schema=https://promptfoo.dev/config-schema.json
# Shared prompt and optional Rovo wiring: docs/how-to/evaluate-rovo-agent.md
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
    `<!-- cspell:words rovo promptfoo -->
<!-- Shared by promptfoo and your rovo:agent prompt resource.
Wire this file in manifest.yml using docs/how-to/evaluate-rovo-agent.md.
Remove this comment when adapting the example to your agent. -->
You are a helpful translation assistant. Translate the requested context accurately and respond with only the translation.
`,
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
  [
    "docs/how-to/evaluate-rovo-agent.md",
    `# Evaluate a Rovo agent prompt

<!-- cspell:words rovo promptfoo -->

For an app without a Rovo agent, skip the manifest wiring and run the supplied
translation example using the evaluation steps below.

## Wire an existing Rovo agent

Use Forge CLI 10.6.0 or newer for prompt resources.
Drop Calf does not edit \`manifest.yml\`: choose the agent and wire its prompt
yourself.

1. Put your agent's instructions in \`prompts/agent-instructions.md\`, replacing
   the translation example with your real prompt.
2. In \`manifest.yml\`, set your existing \`rovo:agent\` prompt and add a resource
   as shown below. Merge these entries into the existing manifest; keep your
   agent key, name, actions, and other settings.

   \`\`\`yaml
   modules:
     rovo:agent:
       - key: your-agent
         name: Your agent
         prompt: resource:agent-instructions;agent-instructions.md
   resources:
     - key: agent-instructions
       path: prompts
   \`\`\`

3. Keep \`agent_instructions: file://prompts/agent-instructions.md\` in
   \`test/promptfoo-test.yaml\`. Update the contexts, requests, and assertions
   to match your agent's behavior.
4. Run \`forge lint\` to validate the manifest before deploying.

See the [Rovo agent manifest reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/).

## Run the evaluations

1. Install dependencies with \`npm install\`.
2. Set \`GEMINI_API_KEY\` in your shell for the configured Google provider.
   Do not commit the key. Evaluation sends the prompt and test contexts to this
   provider and may incur charges; use synthetic or approved data.
3. From the repository root, run \`npm run eval -- --no-cache\`.
4. Run \`npm run view\` to inspect results.

Treat results as a prompt simulation, not a deployed Rovo integration test:
this suite does not exercise Rovo's model, actions, permissions, or live context.
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
