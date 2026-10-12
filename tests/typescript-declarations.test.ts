import { expect, test } from "bun:test";
import { validateCapabilities } from "../src/capability.ts";
import { typeScriptToolchain } from "../src/typescript.ts";
import { mockContainer } from "./container-source.ts";
import { mockDirectory, mockModuleSource } from "./module-source.ts";
import { runUpdate } from "./capability-fixtures.ts";

test("TypeScript enforces declaration emission and keeps owner compiler settings", async () => {
  const source = mockModuleSource();
  try {
    const input = mockDirectory(
      new Map([
        [
          "package.json",
          '{"devDependencies":{"tsdown":"^0.23"},"scripts":{"build":"sh scripts/build.sh"}}',
        ],
        [
          "tsconfig.declarations.json",
          '{\n // owner note\n "extends":"./owner.json", "include":["test"], "compilerOptions":{"declaration":false,"emitDeclarationOnly":false,"rootDir":".","outDir":"out","paths":{"@/*":["src/*"]},"declarationMap":true}\n}\n',
        ],
      ]),
    );
    const output = await runUpdate(
      typeScriptToolchain(undefined, false),
      input,
    );
    const contents = await output.file("tsconfig.declarations.json").contents();
    expect(contents).toContain("// owner note");
    const { parseConfigFileTextToJson } = await import("typescript");
    expect(parseConfigFileTextToJson("config.json", contents).config).toEqual({
      extends: "./tsconfig.json",
      include: ["src"],
      compilerOptions: {
        declaration: true,
        emitDeclarationOnly: true,
        rootDir: "./src",
        outDir: "./dist",
        module: "ESNext",
        moduleResolution: "Bundler",
        paths: { "@/*": ["src/*"] },
        declarationMap: true,
      },
    });
    expect(
      JSON.parse(await output.file("package.json").contents()).scripts.build,
    ).toBe("sh scripts/build.sh");
    expect(await runUpdate(typeScriptToolchain(undefined, false), output)).toBe(
      output,
    );
    const removed = output.withNewFile("package.json", "{}");
    expect(
      await (await runUpdate(typeScriptToolchain(), removed))
        .file("tsconfig.declarations.json")
        .contents(),
    ).toBe(contents);
  } finally {
    source.mockRestore();
  }
});

test("validation checks existing declarations with the compiler even without a tsdown declaration", async () => {
  const { spy, commands, mounts } = mockContainer();
  const input = mockDirectory(
    new Map([
      ["tsconfig.json", "{}"],
      ["tsconfig.typecheck.json", "{}"],
      [
        "tsconfig.declarations.json",
        '{"compilerOptions":{"emitDeclarationOnly":false}}',
      ],
    ]),
  );
  try {
    expect(
      (await validateCapabilities(input, [typeScriptToolchain()]))[0]?.status,
    ).toBe("validated");
    expect(commands).toContainEqual([
      "tsc",
      "--showConfig",
      "--project",
      "tsconfig.declarations.json",
    ]);
    expect(mounts).toEqual([{ path: "/repo", readOnly: true }]);
    expect(input.files.size).toBe(3);
  } finally {
    spy.mockRestore();
  }
});
