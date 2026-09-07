import { fromMarkdown, UnsupportedConstructError } from './from-markdown';
import { toMarkdown } from './to-markdown';

export type ProbeResult =
  | { ok: true }
  | { ok: false; reason: 'unsupported_construct' | 'not_byte_identical'; construct?: string; line?: number };

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
    if (error instanceof UnsupportedConstructError) {
      return { ok: false, reason: 'unsupported_construct', construct: error.construct, line: error.line };
    }
    return { ok: false, reason: 'unsupported_construct' };
  }
}
