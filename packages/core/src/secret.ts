/**
 * Wrapper for values that must never be logged, serialised into a
 * response, or rendered (design.md — "Credentials that must never be
 * logged, serialised or rendered"): password hashes, session tokens,
 * reset tokens, invitation tokens, SMTP credentials. `toString()` and
 * `toJSON()` both return a fixed marker, so an accidental
 * `JSON.stringify`, template interpolation, or `console.log` on the
 * wrapper is inert by construction — no discipline required at every call
 * site. `reveal()` is the one deliberate escape hatch for the call site
 * that legitimately needs the raw value (e.g. comparing it, or handing it
 * to the one adapter that must send it over the wire).
 */
const REDACTED = '[redacted]';

export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
  }

  reveal(): T {
    return this.#value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }
}
