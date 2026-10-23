/** A named precondition: when `fails` holds for the subject, the run stops with `message`. */
export type Guard<T> = {
  fails: (subject: T) => boolean;
  message: string | ((subject: T) => string);
};

/** A JSON-style object: not null, not an array. */
export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Throws for the first failing guard, evaluating guards lazily and in order. */
export function enforce<T>(subject: T, guards: readonly Guard<T>[]): void {
  const broken = guards.find(({ fails }) => fails(subject));
  if (!broken) return;
  throw new Error(
    typeof broken.message === "function"
      ? broken.message(subject)
      : broken.message,
  );
}

/** Runs `run` with environment variables set, restoring each prior value afterwards. */
export function withEnv<T>(vars: Record<string, string>, run: () => T): T {
  const prior = Object.keys(vars).map(
    (name) => [name, process.env[name]] as const,
  );
  try {
    Object.assign(process.env, vars);
    return run();
  } finally {
    for (const [name, value] of prior)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  }
}
