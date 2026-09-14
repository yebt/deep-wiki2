import { fromMarkdown, UnsupportedConstructError } from './from-markdown';
import { toMarkdown } from './to-markdown';

/**
 * `construct` and `line` are REQUIRED on the `unsupported_construct`
 * variant, not optional. The edit screen renders both, and the API's
 * edit-session route (WU-12) copies both into its 409 body: a refusal that
 * names neither leaves the UI with "we will not open this page" and nothing
 * the author can act on, which is a defect in its own right regardless of
 * why the refusal happened. Making them required is what stops the next
 * unexpected throw from silently becoming one again — `refusalFor` below
 * cannot compile without supplying them.
 *
 * `not_byte_identical` carries a `line` and no `construct` on purpose: the
 * document parses fine, so there is no offending construct to name, only
 * the place where the re-serialised bytes first diverge.
 */
export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported_construct'; construct: string; line: number }
  | { ok: false; reason: 'not_byte_identical'; line: number };

/**
 * The 1-based line number of the first character at which `a` and `b`
 * diverge, or `1` if one is empty and the other is not — used to give the
 * edit-session route's 409 body (WU-12) something to point at rather than
 * only "these strings differ".
 */
function firstDivergenceLine(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let index = 0;
  while (index < max && a[index] === b[index]) index++;

  let line = 1;
  for (let i = 0; i < index; i++) {
    if (a[i] === '\n') line++;
  }
  return line;
}

/**
 * Turns whatever the conversion threw into a refusal that can explain
 * itself.
 *
 * An `UnsupportedConstructError` already knows the mdast type and the source
 * line, and that is the path bucket C was designed for. Anything else is a
 * conversion the schema could not perform for a reason nobody anticipated —
 * an empty document was one, hitting `doc`'s `block+` content expression as
 * a bare `RangeError` — and the honest report is the error's own name and
 * line 1, never a blank refusal. Exported so both branches are directly
 * testable: the second one used to be reachable only through a defect, which
 * is exactly why it went unnoticed.
 */
export function refusalFor(error: unknown): ProbeResult {
  if (error instanceof UnsupportedConstructError) {
    return { ok: false, reason: 'unsupported_construct', construct: error.construct, line: error.line ?? 1 };
  }
  const construct = error instanceof Error ? error.name : typeof error;
  return { ok: false, reason: 'unsupported_construct', construct, line: 1 };
}

/**
 * The per-document fail-closed check (design.md "Fail-closed: the
 * per-document probe"): `toMarkdown(fromMarkdown(md)) === md`. Edit mode
 * only opens when this holds; a document whose constructs the schema
 * neither models nor carries verbatim is refused, not silently opened and
 * dropped (markdown-round-trip: Unrepresentable Content Fails Closed).
 */
export function probe(markdown: string): ProbeResult {
  try {
    const doc = fromMarkdown(markdown);
    const back = toMarkdown(doc);
    if (back === markdown) return { ok: true };
    return { ok: false, reason: 'not_byte_identical', line: firstDivergenceLine(markdown, back) };
  } catch (error) {
    return refusalFor(error);
  }
}
