import { expect, test } from "bun:test";
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
