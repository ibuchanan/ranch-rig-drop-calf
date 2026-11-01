/** The one catchable umbrella for failures Drop Calf reports to a repository owner. */
export abstract class DropCalfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** A repository file Drop Calf must read is malformed; the owner fixes it first. */
export class ParseError extends DropCalfError {
  constructor(path: string, reason: string) {
    super(`cannot parse ${path}: ${reason}; fix the file before continuing.`);
  }
}

/** The caller's kind, selection, or capability options are not valid. */
export class InvalidOptionsError extends DropCalfError {
  constructor(message: string) {
    super(message);
  }
}

/** Everything specs/02 §6 requires a failure to name, in one shape. */
type Failure = {
  /** The capability or workflow stage that discovered the failure. */
  readonly source: string;
  /** The file, key, or ref the failure concerns, when it concerns one. */
  readonly path?: string;
  /** What was found. */
  readonly discovered: string;
  /** What the policy requires instead, when it differs from the discovery. */
  readonly wanted?: string;
  /** The owner's next step. */
  readonly remedy: string;
};

/** Trailing sentence punctuation is added once, so details may include it. */
const withoutStop = (text: string) => text.trim().replace(/\.+$/, "");

/** `function: path: discovered; wanted ...; remedy.` */
function formatFailure({
  source,
  path,
  discovered,
  wanted,
  remedy,
}: Failure): string {
  const subject = `${source}:${path ? ` ${path}:` : ""} ${withoutStop(discovered)}`;
  const requirement = wanted ? `; wanted ${withoutStop(wanted)}` : "";
  return `${subject}${requirement}; ${withoutStop(remedy)}.`;
}

/** A structured failure that carries the fields its message names. */
abstract class FailureError extends DropCalfError {
  readonly failure: Failure;

  constructor(failure: Failure) {
    super(formatFailure(failure));
    this.failure = Object.freeze({ ...failure });
  }
}

/** A required input, tool, or credential is absent before the workflow can run. */
export class PrerequisiteError extends FailureError {}

/** Existing owner content collides with a resource or policy Drop Calf owns. */
export class ConflictError extends FailureError {}

/** Content parsed, but breaks a rule the owning capability declares. */
export class ValidationError extends FailureError {}
