import { expect, test } from "bun:test";
import { bunTools, nodeContainer, npmTools, runTool } from "../src/tool-run.ts";
import { TOOL_VERSIONS } from "../src/versions.ts";
import { mockContainer } from "./container-source.ts";

test("nodeContainer builds the baseline image through native Dagger", () => {
  const { container, images, spy } = mockContainer();
  try {
    expect(nodeContainer()).toBe(container as never);
    expect(images).toEqual(["node:24"]);
  } finally {
    spy.mockRestore();
  }
});

test("bunTools grafts pinned Bun onto the baseline and installs without scripts", () => {
  const { commands, copied, images, spy } = mockContainer();
  try {
    bunTools("a@1", "b@2");
    expect(images).toEqual(["node:24", `oven/bun:${TOOL_VERSIONS.bun}`]);
    expect(copied).toEqual(["/usr/local/bin/bun"]);
    expect(commands).toEqual([
      ["bun", "add", "--ignore-scripts", "a@1", "b@2"],
    ]);
  } finally {
    spy.mockRestore();
  }
});

test("npmTools installs globally on the baseline", () => {
  const { commands, images, spy } = mockContainer();
  try {
    npmTools("a@1");
    expect(images).toEqual(["node:24"]);
    expect(commands).toEqual([
      ["npm", "install", "--global", "--no-fund", "--no-audit", "a@1"],
    ]);
  } finally {
    spy.mockRestore();
  }
});

test("runTool returns the evaluated container on success", async () => {
  const { container, spy } = mockContainer();
  try {
    expect(await runTool(container as never, "tool")).toBe(container as never);
  } finally {
    spy.mockRestore();
  }
});

test.each([
  [{ stdout: "out", stderr: "err" }, "out\nerr"],
  [{ stdout: "", stderr: " err \n" }, "err"],
  [{ stdout: "out" }, "out"],
  [{ stdout: "  ", stderr: "" }, "exec failed"],
  [{}, "exec failed"],
])(
  "runTool reports the tool's own output with one convention: %j",
  async (streams, diagnostic) => {
    const failure = Object.assign(new Error("exec failed"), streams);
    const { container, spy } = mockContainer({ failure });
    try {
      await expect(runTool(container as never, "x: check")).rejects.toThrow(
        new Error(`x: check execution failed: ${diagnostic}`),
      );
    } finally {
      spy.mockRestore();
    }
  },
);

test("runTool rethrows non-Error failures unchanged", async () => {
  const { container, spy } = mockContainer();
  container.stdout = async () => {
    throw "boom";
  };
  try {
    await expect(runTool(container as never, "x")).rejects.toBe("boom");
  } finally {
    spy.mockRestore();
  }
});
