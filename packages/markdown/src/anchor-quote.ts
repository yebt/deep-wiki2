/**
 * Where a reader's quote sits in a block's canonical source
 * (comment-threads spec: "A Comment Captures Its Own Excerpt At
 * Creation"; design.md Decision 1 — "`quote` is the load-bearing field").
 *
 * The one translation between what a reader selects and what the anchor
 * stores. A reader of the cached HTML selects *visible* text — `bold word`
 * where the source says `**bold** word` — and never sees the source at
 * all. Save-time reconciliation (`packages/db/src/comments/
 * reconcile-comments.ts`) compares the stored quote against the block's
 * *source* by exact substring first, and only then by trigram containment
 * at 0.8. A quote that is not a source substring would therefore skip the
 * exact rows on every later save, and a short selection across two words
 * of markup can score under the threshold — orphaning a comment on a
 * block nobody touched. So the stored quote is always a substring of the
 * source, chosen here, in order:
 *
 *   1. The quote occurs in the source verbatim → that occurrence (the one
 *      nearest `offsetHint` when it occurs more than once — the same rule
 *      reconciliation applies).
 *   2. The quote is a *subsequence* of the source — its characters appear
 *      in order with markup between them → the smallest source window
 *      that contains it, so `Hello world` over `Hello **world**` stores
 *      `Hello **world`, offsets 0–13. Smallest, not first: the first
 *      window starting at the first `H` could stretch across the whole
 *      block when a later, tighter match exists.
 *   3. Anything else, or no quote at all → the whole block, minus a
 *      trailing persisted ` ^id`: the anchor is identity, not excerpt, and
 *      the excerpt is what a thread shows a person.
 */
import { stripTrailingAnchor } from './extensions/block-anchor';

export interface LocatedQuote {
  readonly offsetStart: number;
  readonly offsetEnd: number;
  /** Always `source.slice(offsetStart, offsetEnd)`. */
  readonly quote: string;
}

/** Every index at which `needle` occurs in `haystack` — non-overlapping, left to right. */
function allIndicesOf(haystack: string, needle: string): number[] {
  const indices: number[] = [];
  let from = 0;
  for (;;) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) return indices;
    indices.push(index);
    from = index + needle.length;
  }
}

/** The smallest `[start, end)` window of `source` in which `needle` appears as a subsequence; `null` when it never does. Earliest window wins a tie. */
function smallestSubsequenceWindow(source: string, needle: string): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null;
  for (let start = 0; start < source.length; start++) {
    if (source[start] !== needle[0]) continue;
    let cursor = start;
    let matched = 0;
    while (cursor < source.length && matched < needle.length) {
      if (source[cursor] === needle[matched]) matched++;
      cursor++;
    }
    if (matched < needle.length) break; // No window from here on can contain it either.
    if (!best || cursor - start < best.end - best.start) best = { start, end: cursor };
  }
  return best;
}

export function locateQuoteInBlock(source: string, quote: string | undefined, offsetHint?: number): LocatedQuote {
  const wanted = quote?.trim() ?? '';
  if (wanted.length > 0) {
    const occurrences = allIndicesOf(source, wanted);
    if (occurrences.length > 0) {
      const target = offsetHint ?? 0;
      const start = occurrences.reduce((nearest, index) => (Math.abs(index - target) < Math.abs(nearest - target) ? index : nearest));
      return { offsetStart: start, offsetEnd: start + wanted.length, quote: wanted };
    }
    const window = smallestSubsequenceWindow(source, wanted);
    if (window) {
      return { offsetStart: window.start, offsetEnd: window.end, quote: source.slice(window.start, window.end) };
    }
  }

  const whole = stripTrailingAnchor(source);
  return { offsetStart: 0, offsetEnd: whole.length, quote: whole };
}
