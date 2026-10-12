import { expect, spyOn, test } from "bun:test";
import { type Directory, dag } from "@dagger.io/dagger";
import {
  noOpReasons,
  updateCapabilities,
  validateCapabilities,
} from "../src/capability.ts";
import { DropCalf } from "../src/index.ts";
import { buildProject } from "../src/profiles.ts";
import { createBlueprint } from "../src/project.ts";
import { bundleSize, SIZE_LIMIT_COMMAND } from "../src/size-limit.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { runUpdate, runInit } from "./capability-fixtures.ts";

const validationReason =
  "Size Limit has no supported configuration-only validation interface. Measurement requires build artifacts and belongs to the size workflow; validation does not build the project or assess potentially stale output.";
const tunedBudget = [
  {
    name: "Owner bundle",
    path: ["build/*.js", "!build/vendor.js"],
    limit: "25 kB",
    gzip: false,
  },
  { name: "Styles", path: "build/*.css", limit: "5 kB", brotli: true },
];

test("library and Forge seed an owned size command, paired pins and matching budget", () => {
  for (const [kind, budget] of [
    [
      "library",
      { name: "Library bundle", path: "dist/index.mjs", limit: "10 kB" },
    ],
    [
      "forge-app",
      { name: "Forge app bundle", path: "dist/**/*.js", limit: "10 kB" },
    ],
  ] as const) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.size).toBe(SIZE_LIMIT_COMMAND);
    expect(packageJson.devDependencies["size-limit"]).toBe(
      TOOL_VERSIONS.sizeLimit,
    );
    expect(packageJson.devDependencies["@size-limit/file"]).toBe(
      TOOL_VERSIONS.sizeLimit,
    );
    expect(packageJson["size-limit"]).toEqual([budget]);
  }
  for (const kind of ["tool", "agent-skill"]) {
    const { packageJson } = buildProject(kind, "sample", "tester");
    expect(packageJson.scripts.size).toBeUndefined();
    expect(packageJson.devDependencies["size-limit"]).toBeUndefined();
    expect(packageJson.devDependencies["@size-limit/file"]).toBeUndefined();
    expect(packageJson["size-limit"]).toBeUndefined();
  }
});

test("init seeds the selected budget and update maintains only the selected paired pin and command", async () => {
  const capability = bundleSize("Selected bundle", "build/main.js", "11.1.0");
  const project = createBlueprint("sample", "", "tester");
  project.packageJson["size-limit"] = [
    { name: "scaffold", path: "old.js", limit: "1 kB" },
  ];
  runInit(capability, project);
  expect(project.packageJson["size-limit"]).toEqual([
    { name: "Selected bundle", path: "build/main.js", limit: "10 kB" },
  ]);
  expect(project.packageJson.devDependencies).toEqual({
    "size-limit": "11.1.0",
    "@size-limit/file": "11.1.0",
  });
  expect(project.files.size).toBe(0);
  expect(project.templates.map((template) => template.path)).toEqual([]);
  const input = mockDirectory(
    new Map([
      [
        "package.json",
        JSON.stringify({
          name: "owner",
          scripts: {
            size: "owner command",
            build: "owner build",
            custom: "keep",
          },
          devDependencies: {
            "size-limit": "0.0.1",
            "@size-limit/file": "0.0.1",
            owner: "1",
          },
          dependencies: { keep: "1" },
          "size-limit": tunedBudget,
        }),
      ],
      [".size-limit.json", "owner config, even invalid"],
      ["bun.lock", "owner lock"],
      ["dist/index.js", "stale output"],
    ]),
  );
  const before = [...input.files];
  const output = await updateCapabilities(input, [capability]);
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    name: "owner",
    scripts: { size: SIZE_LIMIT_COMMAND, build: "owner build", custom: "keep" },
    devDependencies: {
      "size-limit": "11.1.0",
      "@size-limit/file": "11.1.0",
      owner: "1",
    },
    dependencies: { keep: "1" },
    "size-limit": tunedBudget,
  });
  for (const [path, text] of input.files)
    if (path !== "package.json")
      expect(await output.file(path).contents()).toBe(text);
  expect([...input.files]).toEqual(before);
  expect(await updateCapabilities(output, [capability])).toBe(output);
});

test("update creates missing owned keys but not a missing package or budget, retaining matching bytes", async () => {
  const empty = mockDirectory();
  expect(await runUpdate(bundleSize("sample", "dist/index.mjs"), empty)).toBe(
    empty,
  );
  const output = await runUpdate(
    bundleSize("sample", "dist/index.mjs"),
    mockDirectory(new Map([["package.json", "{}"]])),
  );
  const pkg = JSON.parse(await output.file("package.json").contents());
  expect(pkg).toEqual({
    scripts: { size: SIZE_LIMIT_COMMAND },
  });
  const text = `${JSON.stringify(pkg, null, 4)}\r\n`;
  const matching = output.withNewFile("package.json", text);
  expect(
    await runUpdate(bundleSize("sample", "dist/index.mjs"), matching),
  ).toBe(matching);
  expect(await matching.file("package.json").contents()).toBe(text);
});

test.each([
  { budget: null },
  { budget: [] },
  { budget: "invalid" },
  { budget: { path: "owner" } },
])(
  "update does not validate or repair an owner budget: %j",
  async ({ budget }) => {
    const output = await runUpdate(
      bundleSize("sample", "dist/index.mjs"),
      mockDirectory(
        new Map([["package.json", JSON.stringify({ "size-limit": budget })]]),
      ),
    );
    expect(
      JSON.parse(await output.file("package.json").contents())["size-limit"],
    ).toEqual(budget);
    expect(
      await runUpdate(bundleSize("sample", "dist/index.mjs"), output),
    ).toBe(output);
  },
);

test.each([
  "{",
  "null",
  "[]",
  '{"scripts":null}',
  '{"scripts":[]}',
  '{"scripts":"bad"}',
  '{"devDependencies":null}',
  '{"devDependencies":[]}',
  '{"devDependencies":"bad"}',
])(
  "update rejects unsafe package shape without writes: %s",
  async (contents) => {
    const input = mockDirectory(new Map([["package.json", contents]]));
    await expect(
      runUpdate(bundleSize("sample", "dist/index.mjs"), input),
    ).rejects.toThrow("package.json");
    expect(await input.file("package.json").contents()).toBe(contents);
  },
);

test.each(["library", "forge-app"])(
  "%s composed update preserves tuned budgets and deletion idempotently",
  async (kind) => {
    const source = mockModuleSource();
    const empty = spyOn(dag, "directory").mockImplementation(() =>
      mockDirectory(),
    );
    try {
      const module = new DropCalf();
      const initialized = await module.init(
        mockDirectory(),
        kind,
        "tester",
        "sample",
      );
      expect(await module.update(initialized, kind)).toBe(initialized);
      const pkg = JSON.parse(await initialized.file("package.json").contents());
      pkg["size-limit"] = tunedBudget;
      pkg.scripts.size = "owner command";
      pkg.devDependencies["size-limit"] = "0.0.1";
      pkg.devDependencies["@size-limit/file"] = "0.0.1";
      const output = await module.update(
        initialized.withNewFile("package.json", JSON.stringify(pkg)),
        kind,
      );
      const updated = JSON.parse(await output.file("package.json").contents());
      expect(updated["size-limit"]).toEqual(tunedBudget);
      expect(updated.scripts.size).toBe(SIZE_LIMIT_COMMAND);
      expect(updated.devDependencies["size-limit"]).toBe(
        TOOL_VERSIONS.sizeLimit,
      );
      expect(updated.devDependencies["@size-limit/file"]).toBe(
        TOOL_VERSIONS.sizeLimit,
      );
      expect(await module.update(output, kind)).toBe(output);
      delete updated["size-limit"];
      const deleted = output.withNewFile(
        "package.json",
        JSON.stringify(updated),
      );
      expect(await module.update(deleted, kind)).toBe(deleted);
    } finally {
      empty.mockRestore();
      source.mockRestore();
    }
  },
);

test("validation is an enumerable no-op without repository reads, tools or measurement", async () => {
  const capability = bundleSize("Unused", "unused.js");
  expect(
    noOpReasons([capability]).filter((entry) => entry.verb === "validate"),
  ).toEqual([
    { capability: "size-limit", verb: "validate", reason: validationReason },
  ]);
  const input = new Proxy({} as Directory, {
    get() {
      throw new Error("Validation must not access the repository");
    },
  });
  const container = spyOn(dag, "container").mockImplementation(() => {
    throw new Error("Validation must not install or run tools");
  });
  try {
    expect(await validateCapabilities(input, [capability])).toEqual([
      { capability: "size-limit", status: "skipped", reason: validationReason },
    ]);
    expect(container).not.toHaveBeenCalled();
  } finally {
    container.mockRestore();
  }
});
