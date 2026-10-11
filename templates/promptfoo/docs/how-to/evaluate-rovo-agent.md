# Evaluate a Rovo agent prompt

<!-- cspell:words rovo promptfoo -->

For an app without a Rovo agent, skip the manifest wiring and run the supplied
translation example using the evaluation steps below.

## Wire an existing Rovo agent

Use Forge CLI 10.6.0 or newer for prompt resources.
Drop Calf does not edit `manifest.yml`: choose the agent and wire its prompt
yourself.

1. Put your agent's instructions in `prompts/agent-instructions.md`, replacing
   the translation example with your real prompt.
2. In `manifest.yml`, set your existing `rovo:agent` prompt and add a resource
   as shown below. Merge these entries into the existing manifest; keep your
   agent key, name, actions, and other settings.

   ```yaml
   modules:
     rovo:agent:
       - key: your-agent
         name: Your agent
         prompt: resource:agent-instructions;agent-instructions.md
   resources:
     - key: agent-instructions
       path: prompts
   ```

3. Keep `agent_instructions: file://prompts/agent-instructions.md` in
   `test/promptfoo-test.yaml`. Update the contexts, requests, and assertions
   to match your agent's behavior.
4. Run `forge lint` to validate the manifest before deploying.

See the [Rovo agent manifest reference](https://developer.atlassian.com/platform/forge/manifest-reference/modules/rovo-agent/).

## Run the evaluations

1. Install dependencies with `npm install`.
2. Set `GEMINI_API_KEY` in your shell for the configured Google provider.
   Do not commit the key. Evaluation sends the prompt and test contexts to this
   provider and may incur charges; use synthetic or approved data.
3. From the repository root, run `npm run eval -- --no-cache`.
4. Run `npm run view` to inspect results.

Treat results as a prompt simulation, not a deployed Rovo integration test:
this suite does not exercise Rovo's model, actions, permissions, or live context.
