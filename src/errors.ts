/** A repository file Drop Calf must read is malformed; the owner fixes it first. */
export class ParseError extends Error {
  constructor(path: string, reason: string) {
    super(`cannot parse ${path}: ${reason}; fix the file before continuing.`);
    this.name = "ParseError";
  }
}
