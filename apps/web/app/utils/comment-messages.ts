/**
 * What the comment flow says when a write succeeds.
 *
 * Four sentences, in one place, because each is said twice: the panel's
 * live region carries it (the thing a screen reader is reliably given) and
 * the toast carries it (the thing a sighted person reads) — the pairing
 * docs/UI-CHECKLIST.md §4.12 describes. Two copies of one sentence in two
 * files is exactly the drift §4.1 exists to prevent.
 *
 * §4.12 also rules what a toast may say: "A toast says what happened to
 * what. 'Saved.' is §3's own example of a confirmation too weak to act
 * on." A comment thread's "what" is the text it is anchored to, so every
 * sentence names it — cut short, because a toast is one sentence and a
 * block's excerpt can be a paragraph.
 */

/** Long enough to recognise the sentence, short enough that the toast stays one line at 320px. */
const MAX_QUOTE = 44;

/**
 * A thread's excerpt as a short quotation — `“The soft lock is taken on
 * entering edit mode…”` — or the empty string when there is nothing to
 * quote, so a caller can leave the clause out rather than quote nothing.
 *
 * Whitespace is collapsed first: a block's excerpt is its source text and
 * may carry the newlines and indentation the Markdown had.
 */
export function shortQuote(quote: string): string {
  const collapsed = quote.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0) return '';
  if (collapsed.length <= MAX_QUOTE) return `“${collapsed}”`;
  const cut = collapsed.slice(0, MAX_QUOTE);
  // Cut between words when there is a space to cut at; a half-word reads as
  // a typo rather than as an abbreviation. One very long word has none, and
  // is cut where the budget runs out.
  const lastSpace = cut.lastIndexOf(' ');
  const head = lastSpace > MAX_QUOTE / 2 ? cut.slice(0, lastSpace) : cut;
  return `“${head}…”`;
}

function about(verb: string, quote: string): string {
  const short = shortQuote(quote);
  return short === '' ? `${verb}.` : `${verb} on ${short}.`;
}

export function commentPosted(quote: string): string {
  return about('Comment posted', quote);
}

export function replyPosted(quote: string): string {
  return about('Reply posted', quote);
}

export function threadResolution(quote: string, resolved: boolean): string {
  return about(resolved ? 'Thread resolved' : 'Thread reopened', quote);
}
