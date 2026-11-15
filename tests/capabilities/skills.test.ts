import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { skills } from "../../src/capabilities/skills.ts";
import {
  buildProject,
  resolveProfile,
} from "../../src/composition/profiles.ts";
import { noOpReasons } from "../../src/core/capability.ts";
import { updatePackage } from "../../src/core/package-json.ts";
import { TOOL_VERSIONS } from "../../src/core/versions.ts";
import { mockDirectory } from "../support/module-source.ts";

test.each(["forge-app"])("%s links installed skills during prepare", (kind) => {
  const { packageJson } = buildProject(kind, "sample", "tester");
  expect(packageJson.devDependencies).toMatchObject({
    "agent-skills-toolkit": "github:ibuchanan/agent-skills-toolkit",
    "skill-wrangler": "github:ibuchanan/ranch-hand-skill-wrangler.git",
    "npm-run-all2": TOOL_VERSIONS.npmRunAll2,
  });
  expect(packageJson.scripts).toMatchObject({
    prepare: "run-s --npm-path npm prepare:hooks 'skill:link-*'",
    "prepare:hooks": "lefthook install || true",
    "skill:link-wrangler": "link-skills --package skill-wrangler",
  });
  for (const dependency of ["agent-skills-toolkit", "skill-wrangler"])
    expect(
      resolveProfile(kind)
        .filter(
          ({ packageJson }) =>
            dependency in (packageJson?.seed?.devDependencies ?? {}),
        )
        .map(({ name }) => name),
    ).toEqual(["skills"]);
});

test.each(["library", "tool", "agent-skill"])(
  "%s retains its existing workflow without skills linking",
  (kind) => {
    const { scripts, devDependencies } = buildProject(
      kind,
      "sample",
      "tester",
    ).packageJson;
    expect(resolveProfile(kind).map(({ name }) => name)).not.toContain(
      "skills",
    );
    expect(scripts.prepare).toBe(
      kind === "library"
        ? "npm run build && (lefthook install || true)"
        : "lefthook install || true",
    );
    expect(scripts["prepare:hooks"]).toBeUndefined();
    expect(scripts["skill:link-wrangler"]).toBeUndefined();
    expect(devDependencies["skill-wrangler"]).toBeUndefined();
    expect(devDependencies["agent-skills-toolkit"]).toBe(
      kind === "agent-skill" ? TOOL_VERSIONS.agentSkillsToolkit : undefined,
    );
  },
);

test("skills is file-free with explicit inactive verbs", () => {
  expect(noOpReasons([skills()]).map(({ verb }) => verb)).toEqual([
    "init",
    "update",
    "validate",
  ]);
});

test("update restores linking policy and preserves custom link tasks and dependency references", async () => {
  const pkg = {
    scripts: {
      "skill:link-wrangler": "owner",
      "skill:link-extra": "link-skills --package extra",
    },
    devDependencies: {
      "agent-skills-toolkit": "github:owner/toolkit#revision",
      "skill-wrangler": "github:owner/wrangler#revision",
    },
  };
  const input = mockDirectory(new Map([["package.json", JSON.stringify(pkg)]]));
  const output = await updatePackage(input, [skills()]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    ...pkg,
    scripts: {
      ...pkg.scripts,
      "skill:link-wrangler": "link-skills --package skill-wrangler",
    },
  });
  expect(await updatePackage(output, [skills()])).toBe(output);
});

test.each([
  { fail: "", expected: ["hooks", "wrangler", "extra"] },
  { fail: "hooks", expected: ["hooks", "wrangler", "extra"] },
  { fail: "wrangler", expected: ["hooks", "wrangler"] },
])(
  "Forge prepare executes in order with failure at '$fail'",
  ({ fail, expected }) => {
    const scratch = join(import.meta.dir, "../../.scratch");
    mkdirSync(scratch, { recursive: true });
    const root = mkdtempSync(join(scratch, "tmp_rovo_prepare_"));
    try {
      writeFileSync(
        join(root, "task.cjs"),
        `require('node:fs').appendFileSync('order', process.argv[2] + '\\n'); process.exit(process.argv[2] === ${JSON.stringify(fail)} ? 1 : 0);`,
      );
      const task = (name: string) => `"${process.execPath}" task.cjs ${name}`;
      const { scripts } = buildProject(
        "forge-app",
        "sample",
        "tester",
      ).packageJson;
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({
          scripts: {
            ...scripts,
            "prepare:hooks": `${task("hooks")} || true`,
            "skill:link-wrangler": task("wrangler"),
            "skill:link-extra": task("extra"),
          },
        }),
      );
      const result = Bun.spawnSync(["npm", "run", "prepare"], {
        cwd: root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode === 0, result.stderr.toString()).toBe(
        fail !== "wrangler",
      );
      expect(
        readFileSync(join(root, "order"), "utf8").trim().split("\n"),
      ).toEqual([...expected]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
