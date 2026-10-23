import { expect, test } from "bun:test";
import { enforce, type Guard, withEnv } from "../../src/core/guards.ts";

test("enforce throws the first failing guard's message and skips later guards", () => {
  const evaluated: string[] = [];
  const guards: Guard<number>[] = [
    {
      fails: () => {
        evaluated.push("a");
        return false;
      },
      message: "a",
    },
    {
      fails: (n) => {
        evaluated.push("b");
        return n > 1;
      },
      message: (n) => `b saw ${n}`,
    },
    {
      fails: () => {
        evaluated.push("c");
        return true;
      },
      message: "c",
    },
  ];
  expect(() => enforce(2, guards)).toThrow("b saw 2");
  expect(evaluated).toEqual(["a", "b"]);
});

test("enforce returns quietly when every guard passes", () => {
  expect(() =>
    enforce(0, [{ fails: () => false, message: "no" }]),
  ).not.toThrow();
  expect(() => enforce(0, [])).not.toThrow();
});

test("withEnv sets variables for the call and restores or removes them afterwards", () => {
  process.env.GUARDS_TEST_KEPT = "before";
  delete process.env.GUARDS_TEST_ADDED;
  const seen = withEnv(
    { GUARDS_TEST_KEPT: "during", GUARDS_TEST_ADDED: "during" },
    () => [process.env.GUARDS_TEST_KEPT, process.env.GUARDS_TEST_ADDED],
  );
  expect(seen).toEqual(["during", "during"]);
  expect(process.env.GUARDS_TEST_KEPT).toBe("before");
  expect("GUARDS_TEST_ADDED" in process.env).toBe(false);
  delete process.env.GUARDS_TEST_KEPT;
});

test("withEnv restores the environment when the callback throws", () => {
  delete process.env.GUARDS_TEST_THROWN;
  expect(() =>
    withEnv({ GUARDS_TEST_THROWN: "x" }, () => {
      throw new Error("boom");
    }),
  ).toThrow("boom");
  expect("GUARDS_TEST_THROWN" in process.env).toBe(false);
});
