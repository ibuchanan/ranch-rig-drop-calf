import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

// Requires Dagger, but never registers, installs, or deploys a Forge app.
const enabled = process.env.DROP_CALF_INIT_E2E === "1";
const repo = join(import.meta.dir, "../..");
const cases = ["library", "forge-app", "tool", "agent-skill"].flatMap(
  (profile) =>
    [undefined, "all"].map((preset) => ({
      profile,
      preset,
      label: preset ?? "default",
    })),
);

test.skipIf(!enabled).each(cases)(
  "$profile empty-directory init-changes exports to a new directory ($label)",
  ({ profile, preset }) => {
    mkdirSync(join(repo, ".scratch"), { recursive: true });
    const root = mkdtempSync(join(repo, ".scratch/tmp_rovo_init_"));
    const input = join(root, "empty");
    const output = join(root, "new-project");
    try {
      mkdirSync(input);
      expect(existsSync(output)).toBe(false);
      execFileSync(
        "dagger",
        [
          "--progress",
          "plain",
          "call",
          "-m",
          repo,
          "init-changes",
          "--directory",
          input,
          "--profile",
          profile,
          "--owner",
          "tester",
          "--package-name",
          "sample",
          ...(preset ? ["--preset", preset] : []),
          "export",
          "--path",
          output,
        ],
        { cwd: repo, encoding: "utf8", timeout: 120_000, stdio: "pipe" },
      );
      const pkg = JSON.parse(
        readFileSync(join(output, "package.json"), "utf8"),
      );
      expect(pkg.name).toBe("sample");
      expect(pkg.engines.node).toBe("24.x");
      expect(readFileSync(join(output, ".atlassian/OWNER"), "utf8")).toBe(
        "tester",
      );
      for (const path of [
        "LICENSE",
        "README.md",
        ".gitignore",
        "biome.jsonc",
        "tsconfig.json",
      ])
        expect(existsSync(join(output, path)), path).toBe(true);
      expect(existsSync(join(output, "manifest.yml"))).toBe(false);
      expect(existsSync(join(output, "src"))).toBe(false);
      expect(existsSync(join(output, "cliff.toml"))).toBe(
        profile !== "agent-skill",
      );
      expect(existsSync(join(output, "promptfooconfig.yaml"))).toBe(
        profile === "forge-app" && preset === "all",
      );
      expect(existsSync(join(input, "package.json"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
