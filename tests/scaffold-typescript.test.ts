import { expect, test } from "bun:test";
import { parseDocument } from "yaml";
import { planScaffoldTypeScript } from "../src/scaffold.ts";

const backend =
  "modules:\n  function:\n    - key: main\n      handler: index.run\n";

test("backend scaffold renames source but preserves extensionless handlers", () => {
  expect(
    planScaffoldTypeScript(["src/index.js", "src/lib/helper.js"], backend),
  ).toEqual({
    renames: [
      { from: "src/index.js", to: "src/index.ts" },
      { from: "src/lib/helper.js", to: "src/lib/helper.ts" },
    ],
    manifest: backend,
  });
});

test("UI Kit rewrites only resources referencing renamed files, preserving other bytes", () => {
  const manifest = `${backend}# UI\r\nresources:\r\n  - key: main\r\n    path: 'src/frontend/index.jsx' # entry\r\n  - key: custom\r\n    path: static/hello-world/build\r\n  - key: unchanged\r\n    path: src/frontend/other.tsx\r\napp:\r\n  id: example\r\n`;
  const plan = planScaffoldTypeScript(
    [
      "src/index.js",
      "src/frontend/index.jsx",
      "src/frontend/other.tsx",
      "static/hello-world/src/App.js",
      "scripts/setup.js",
      "src/data.json",
    ],
    manifest,
  );
  expect(plan.renames).toEqual([
    { from: "src/index.js", to: "src/index.ts" },
    { from: "src/frontend/index.jsx", to: "src/frontend/index.tsx" },
  ]);
  expect(plan.manifest).toBe(
    manifest.replace("src/frontend/index.jsx", "src/frontend/index.tsx"),
  );
  const paths = [
    "src/index.ts",
    "src/frontend/index.tsx",
    "static/hello-world/src/App.js",
  ];
  expect(planScaffoldTypeScript(paths, plan.manifest)).toEqual({
    renames: [],
    manifest: plan.manifest,
  });
});

test.each(["plain", "single", "double", "folded", "literal", "alias"])(
  "resource path edits keep valid YAML with %s scalar syntax",
  (style) => {
    const values: Record<string, string> = {
      plain: "src/index.js",
      single: "'src/index.js'",
      double: '"src/index.js"',
      folded: ">- # folded\n      src/index.js",
      literal: "|- # literal\n      src/index.js",
      alias: "*entry",
    };
    const manifest = `other: &entry src/index.js\nresources:\n  - key: main\n    path: ${values[style]}\n  - key: next\n    path: static/app/build\n`;
    const plan = planScaffoldTypeScript(["src/index.js"], manifest);
    const document = parseDocument(plan.manifest ?? "");
    expect(document.errors).toEqual([]);
    expect(document.toJS().resources[0].path).toBe("src/index.ts");
    expect(document.toJS().resources[1].path).toBe("static/app/build");
    expect(document.toJS().other).toBe("src/index.js");
  },
);

test("already-TypeScript and empty scaffolds are byte-identical no-ops", () => {
  for (const paths of [
    [],
    ["src/index.ts", "src/frontend/index.tsx", "static/app/src/App.js"],
  ])
    expect(planScaffoldTypeScript(paths, backend)).toEqual({
      renames: [],
      manifest: backend,
    });
  expect(planScaffoldTypeScript(["src/index.js"])).toEqual({
    renames: [{ from: "src/index.js", to: "src/index.ts" }],
    manifest: undefined,
  });
});

test.each([
  ["src/index.js", "src/index.ts"],
  ["src/index.jsx", "src/index.tsx"],
])(
  "refuses destination collisions without dropping either file: %j",
  (from, to) => {
    expect(() => planScaffoldTypeScript([from, to], backend)).toThrow(
      `${to} already exists`,
    );
  },
);

test.each([
  "resources: [broken",
  "resources: {}\n",
  "resources:\n  - path: src/index.js\n    path: src/other.js\n",
])(
  "refuses malformed manifest before planning destructive changes: %j",
  (manifest) => {
    expect(() => planScaffoldTypeScript(["src/index.js"], manifest)).toThrow(
      "cannot parse manifest.yml",
    );
  },
);
