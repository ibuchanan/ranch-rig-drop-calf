import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { kinds, runUpdate } from "./capability-fixtures.ts";
import { mockDirectory } from "./module-source.ts";
import { buildProject } from "../src/profiles.ts";
import { TODO_COMMAND, todo } from "../src/todo.ts";

const root = new URL("../.scratch/", import.meta.url).pathname;

test.each(kinds)(
  "%s seeds todo but leaves owner edits alone on update",
  async (kind) => {
    const project = buildProject(kind, "sample", "tester");
    expect(project.packageJson.scripts.todo).toBe(TODO_COMMAND);
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          JSON.stringify({ scripts: { todo: "owner command" } }),
        ],
      ]),
    );
    expect(await runUpdate(todo(), input)).toBe(input);
  },
);

test("todo reports tracked matches, ignores untracked/ignored files, and handles no matches", () => {
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(join(root, "tmp_rovo_todo_"));
  try {
    execFileSync("git", ["init", "-q"], { cwd });
    mkdirSync(join(cwd, "src"));
    mkdirSync(join(cwd, "node_modules"));
    mkdirSync(join(cwd, "dist"));
    writeFileSync(join(cwd, ".gitignore"), "node_modules/\ndist/\n");
    writeFileSync(
      join(cwd, "package.json"),
      JSON.stringify({ scripts: { todo: TODO_COMMAND } }),
    );
    writeFileSync(join(cwd, "src/untracked.ts"), "// TODO untracked\n");
    writeFileSync(
      join(cwd, "node_modules/generated.js"),
      "// TODO dependency\n",
    );
    writeFileSync(join(cwd, "dist/output.js"), "// TODO build output\n");
    execFileSync("git", ["add", ".gitignore", "package.json"], { cwd });

    const run = () =>
      execFileSync("bun", ["run", "todo"], { cwd, encoding: "utf8" });
    expect(run().trim()).toBe("No TODO markers found.");

    writeFileSync(join(cwd, "src/notes.ts"), "first\n// TODO tracked\nnext\n");
    execFileSync("git", ["add", "src/notes.ts"], { cwd });
    expect(run().trim()).toBe("src/notes.ts:2:// TODO tracked");

    writeFileSync(join(cwd, "src/notes.ts"), "// TODO current working tree\n");
    expect(run().trim()).toBe("src/notes.ts:1:// TODO current working tree");

    writeFileSync(join(cwd, "src/notes.ts"), "nothing left\n");
    expect(run().trim()).toBe("No TODO markers found.");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("todo does not hide git errors", () => {
  mkdirSync(root, { recursive: true });
  const cwd = mkdtempSync(join(root, "tmp_rovo_todo_"));
  try {
    const result = spawnSync("sh", ["-c", TODO_COMMAND], {
      cwd,
      env: { ...process.env, GIT_DIR: join(cwd, "missing.git") },
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout.toString()).not.toContain("No TODO markers found.");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
