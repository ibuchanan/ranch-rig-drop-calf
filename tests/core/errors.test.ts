import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  ConflictError,
  DropCalfError,
  InvalidOptionsError,
  ParseError,
  PrerequisiteError,
  ValidationError,
} from "../../src/core/errors.ts";

test("a taxonomy failure names the function, path, discovered, wanted, and remedy", () => {
  const failure = {
    source: "library-build",
    path: "tsdown.config.ts",
    discovered: "conflicts with the managed JSON pipeline",
    wanted: "entry and dependency settings in tsdown.config.json",
    remedy: "move those settings to tsdown.config.json and remove the file",
  };
  const error = new ConflictError(failure);
  expect(error.message).toBe(
    "library-build: tsdown.config.ts: conflicts with the managed JSON pipeline; wanted entry and dependency settings in tsdown.config.json; move those settings to tsdown.config.json and remove the file.",
  );
  expect(error.failure).toEqual(failure);
  expect(error.name).toBe("ConflictError");
});

test("a failure without a path or wanted value still names what it found and the fix", () => {
  const error = new ValidationError({
    source: "secrets",
    discovered: "project.revision must be 1.0",
    remedy: 'restore revision = "1.0"',
  });
  expect(error.message).toBe(
    'secrets: project.revision must be 1.0; restore revision = "1.0".',
  );
});

test("every failure class is one catchable taxonomy", () => {
  const failures = [
    new ParseError("package.json", "unexpected token"),
    new InvalidOptionsError("monorepo requires a name"),
    new PrerequisiteError({
      source: "catalog",
      discovered: "catalog-info.yaml is missing",
      remedy: "run init before update",
    }),
    new ConflictError({
      source: "package.json",
      path: "scripts.lint",
      discovered: "is claimed twice",
      remedy: "remove the key from one contribution",
    }),
    new ValidationError({
      source: "secrets",
      discovered: "project.name must be nonempty",
      remedy: "set project.name",
    }),
  ];
  for (const failure of failures) expect(failure).toBeInstanceOf(DropCalfError);
});

/** specs/02 §6: every failure names its function, path, discovery, and remedy. */
const structuredFailures = [
  PrerequisiteError,
  ConflictError,
  ValidationError,
] as const;

for (const ErrorClass of structuredFailures) {
  test(`${ErrorClass.name} names the function, path, discovery, want, and remedy`, () => {
    const failure = {
      source: "release",
      path: "scripts/release.sh",
      discovered: "is missing",
      wanted: "a one-command release script",
      remedy: "run init or update",
    };
    const error = new ErrorClass(failure);
    expect(error).toBeInstanceOf(DropCalfError);
    expect(error.failure).toEqual(failure);
    expect(error.message).toBe(
      "release: scripts/release.sh: is missing; wanted a one-command release script; run init or update.",
    );
  });
}

test("a parse failure names the file and the step that unblocks the owner", () => {
  const error = new ParseError("package.json", "unexpected token");
  expect(error.message).toBe(
    "cannot parse package.json: unexpected token; fix the file before continuing.",
  );
  expect(error).toBeInstanceOf(DropCalfError);
});

test("the taxonomy in specs/02 §6 matches the exported error classes", async () => {
  const spec = readFileSync(
    new URL("../../specs/02-project-functions.md", import.meta.url),
    "utf8",
  );
  const heading = "## 6. Error and conflict classes";
  expect(spec).toContain(heading);
  const named = [
    ...spec
      .slice(spec.indexOf(heading) + heading.length)
      .matchAll(/`(\w+Error)`/g),
  ]
    .map((match) => match[1] ?? "")
    .sort();
  expect(named).toEqual([
    "ConflictError",
    "InvalidOptionsError",
    "ParseError",
    "PrerequisiteError",
    "ValidationError",
  ]);
  const taxonomy = await import("../../src/core/errors.ts");
  const exported = Object.entries(taxonomy)
    .filter(
      ([name, value]) =>
        name.endsWith("Error") &&
        name !== "DropCalfError" &&
        typeof value === "function",
    )
    .map(([name]) => name)
    .sort();
  expect(exported).toEqual(named);
});
