import { expect, test } from "bun:test";
import { buildProject } from "../src/profiles.ts";
import { gitHooksTemplates } from "./templates-source.ts";

const hooks = () => gitHooksTemplates();
const config = () => hooks().get("lefthook.yml") ?? "";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s installs Lefthook and points its scripts at the shared config",
  (kind) => {
    const { scripts, devDependencies } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    expect(devDependencies.lefthook).toBe("^2.1");
    expect(scripts.prepare).toBe("lefthook install || true");
    expect(scripts.lint).toBe("lefthook run lint");
    expect(scripts.check).toBe("lefthook run pre-push --force");
    const yml = config();
    // The scripts run these groups by name; what each one runs is the
    // template's call.
    expect(yml).toMatch(/^lint:/m);
    expect(yml).toMatch(/^pre-push:/m);
  },
);
