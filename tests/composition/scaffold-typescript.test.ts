import { expect, test } from "bun:test";
import fc from "fast-check";
import { parseDocument } from "yaml";
import { planScaffoldTypeScript } from "../../src/composition/scaffold.ts";

const backend =
  "modules:\n  function:\n    - key: main\n      handler: index.run\n";
const sourceStem = fc
  .array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,16}$/), {
    minLength: 1,
    maxLength: 4,
  })
  .map((segments) => `src/${segments.join("/")}`);

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
    fc.assert(
      fc.property(
        sourceStem,
        fc.constantFrom("js", "jsx"),
        fc.constantFrom("\n", "\r\n"),
        (stem, extension, eol) => {
          const from = `${stem}.${extension}`;
          const to = `${stem}.${extension === "js" ? "ts" : "tsx"}`;
          const values: Record<string, string> = {
            plain: from,
            single: `'${from}'`,
            double: JSON.stringify(from),
            folded: `>- # folded\n      ${from}`,
            literal: `|- # literal\n      ${from}`,
            alias: "*entry",
          };
          const manifest =
            `${backend}other: &entry ${from}\nresources:\n  - key: main\n    path: ${values[style]}\n  - key: same-file\n    path: ${values[style]}\n  - key: next\n    path: static/app/build\n`.replaceAll(
              "\n",
              eol,
            );
          const plan = planScaffoldTypeScript([from], manifest);
          expect(plan.renames).toEqual([{ from, to }]);
          const document = parseDocument(plan.manifest ?? "");
          expect(document.errors).toEqual([]);
          expect(document.toJS()).toEqual({
            modules: { function: [{ key: "main", handler: "index.run" }] },
            other: from,
            resources: [
              { key: "main", path: to },
              { key: "same-file", path: to },
              { key: "next", path: "static/app/build" },
            ],
          });
          if (eol === "\r\n") expect(plan.manifest).not.toMatch(/(?<!\r)\n/);
          expect(planScaffoldTypeScript([to], plan.manifest)).toEqual({
            renames: [],
            manifest: plan.manifest,
          });
        },
      ),
    );
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
  ["js", "ts"],
  ["jsx", "tsx"],
])(
  "refuses %s to %s destination collisions without changing inputs",
  (js, ts) => {
    fc.assert(
      fc.property(sourceStem, fc.boolean(), (stem, reversed) => {
        const from = `${stem}.${js}`;
        const to = `${stem}.${ts}`;
        const paths = reversed ? [to, from] : [from, to];
        const before = [...paths];
        expect(() => planScaffoldTypeScript(paths, backend)).toThrow(
          `${to} already exists`,
        );
        expect(paths).toEqual(before);
      }),
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
