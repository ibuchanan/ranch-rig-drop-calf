import { expect, test } from "bun:test";
import { updateNode } from "../src/node.ts";
import { mockDirectory } from "./module-source.ts";

const catalog =
  "metadata:\n  annotations:\n    forge-ranch/license: Apache-2.0\n";

test.each(["library", "forge-app", "tool", "agent-skill"])(
  "%s Node pulls catalog license, preserving other package values and catalog bytes",
  async (kind) => {
    const pkg = {
      license: "MIT",
      custom: { kept: true },
      scripts: { custom: "echo kept" },
      devDependencies: { kept: "1" },
    };
    const input = mockDirectory(
      new Map([
        ["package.json", JSON.stringify(pkg)],
        ["catalog-info.yaml", catalog],
      ]),
    );
    const output = await updateNode(input, kind);
    expect(JSON.parse(await output.file("package.json").contents())).toEqual({
      ...pkg,
      license: "Apache-2.0",
    });
    expect(await output.file("catalog-info.yaml").contents()).toBe(catalog);
    expect(await updateNode(output, kind)).toBe(output);
    expect(await input.file("package.json").contents()).toBe(
      JSON.stringify(pkg),
    );
  },
);

test("Node adds a missing package license from catalog without adding dependencies", async () => {
  const output = await updateNode(
    mockDirectory(
      new Map([
        ["package.json", "{}"],
        ["catalog-info.yaml", catalog],
      ]),
    ),
    "tool",
  );
  expect(JSON.parse(await output.file("package.json").contents())).toEqual({
    license: "Apache-2.0",
  });
});

test.each([
  undefined,
  "[broken",
  "metadata: {}\nmetadata: {}\n",
  "metadata: {}\n",
  "metadata:\n  annotations:\n    forge-ranch/license: 42\n",
  "metadata:\n  annotations:\n    forge-ranch/license: ' '\n",
])(
  "Node fails clearly on missing or malformed license metadata: %j",
  async (contents) => {
    const files = new Map([["package.json", "{}"]]);
    if (contents !== undefined) files.set("catalog-info.yaml", contents);
    await expect(updateNode(mockDirectory(files), "tool")).rejects.toThrow(
      "catalog-info.yaml",
    );
  },
);

test("Node does not require catalog or create package.json when package is absent", async () => {
  const output = await updateNode(mockDirectory(), "tool");
  expect(await output.exists("package.json")).toBe(false);
});
