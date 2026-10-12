/** A repository file Drop Calf must read is malformed; the owner fixes it first. */
export class ParseError extends Error {
  constructor(path: string, reason: string) {
    super(`cannot parse ${path}: ${reason}; fix the file before continuing.`);
    this.name = "ParseError";
  }
}

/** The caller's kind, selection, or capability options are not valid. */
export class InvalidOptionsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOptionsError";
  }
}
