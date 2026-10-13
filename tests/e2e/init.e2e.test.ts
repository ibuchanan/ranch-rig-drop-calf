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
const cases = ["library", "forge-app", "tool", "agent-skill"].flatMap(
  (profile) =>
    [undefined, "all"].map((preset) => ({
      profile,
      preset,
      label: preset ?? "default",
    })),
);

test.each(cases)(
  "$profile init-changes exports once and both init forms refuse reruns ($label)",
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
      expect(pkg.author).toBe("tester");
      expect(pkg.description).toBe("");
      expect(pkg.private).toBe(true);
      expect(pkg.engines).toBeUndefined();
      expect(readFileSync(join(output, ".atlassian/OWNER"), "utf8")).toBe(
        "tester",
      );
      for (const path of [
        "LICENSE",
        "catalog-info.yaml",
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
      expect(existsSync(join(output, ".fallowrc.jsonc"))).toBe(
        profile === "library" || profile === "tool",
      );
      expect(existsSync(join(input, "package.json"))).toBe(false);

      const ownerFiles = new Map([
        ["README.md", "# Owner-written README\n"],
        ["AGENTS.md", "# Owner-written guidance\n"],
        ["tsconfig.json", "// Owner compiler settings\n{}\n"],
      ]);
      for (const [path, contents] of ownerFiles)
        writeFileSync(join(output, path), contents);
      for (const path of [
        "package.json",
        "catalog-info.yaml",
        ".atlassian/OWNER",
      ])
        ownerFiles.set(path, readFileSync(join(output, path), "utf8"));
      for (const marker of ["catalog-info.yaml", ".atlassian/OWNER"]) {
        if (marker === ".atlassian/OWNER") {
          rmSync(join(output, "catalog-info.yaml"));
          ownerFiles.delete("catalog-info.yaml");
        }
        for (const operation of ["init", "init-changes"]) {
          expect(() =>
            execFileSync(
              "dagger",
              [
                "--progress",
                "plain",
                "call",
                "-m",
                repo,
                operation,
                "--directory",
                output,
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
            ),
          ).toThrow(`${marker} already exists; use update instead`);
          for (const [path, contents] of ownerFiles)
            expect(readFileSync(join(output, path), "utf8"), path).toBe(
              contents,
            );
          expect(existsSync(join(output, "catalog-info.yaml"))).toBe(
            marker === "catalog-info.yaml",
          );
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  180_000,
);
