/**
 * Where a comment's anchored text sits inside the rendered block, and
 * whether it is in front of the reader.
 *
 * The owner, 2026-09-23: *"no me muestra muy bien la relación que hay con
 * respecto a esta parte o a dónde pertenece. Guíate en Word o Google
 * Docs."* In both products a comment is tied to its anchored text by
 * highlighting **that text**, not the paragraph around it. This module is
 * the mapping that makes such a highlight possible, kept apart from the DOM
 * work and from Vue so it can be tested as what it is: a string problem.
 *
 * ## The two alphabets
 *
 * A stored anchor's `quote` is a slice of the block's **Markdown source**,
 * and deliberately so: `locateQuoteInBlock` (`packages/markdown`) stores a
 * source substring because save-time reconciliation compares the stored
 * quote against the block's source by exact substring first, and a quote
 * that is not a source substring would skip that comparison on every later
 * save and eventually orphan a comment nobody touched.
 *
 * What the reader sees is the **rendered** text: `bold word` where the
 * source says `**bold** word`. And a source *window* can carry half a
 * marker — `Hello **world` is what gets stored for a selection of `Hello
 * world` made over `Hello **world**`. So locating the span is a translation,
 * attempted in order of confidence:
 *
 *   1. The quote, with its inline markers removed, occurs in the rendered
 *      text verbatim → that occurrence.
 *   2. It occurs with whitespace differences only (a soft break the source
 *      spelled as a newline and the render as a space, doubled spaces) →
 *      that occurrence, mapped back to real indices.
 *   3. Its characters occur in order with other characters between them →
 *      the smallest window that holds them. This is what catches a marker
 *      the stripper could not tell from prose, `snake_case`'s underscore
 *      above all.
 *   4. Nothing → `null`, and the caller highlights the whole block rather
 *      than guessing at a span inside it. A whole-block highlight is the
 *      honest answer there, and it is also the *correct* one for the common
 *      case, since a thread started from a block's "+" is anchored to the
 *      whole block and step 1 finds exactly that.
 *
 * None of this parses Markdown. It must not: read mode boots no parser
 * (docs/SPECS.md §5.1, `scripts/checks/bundle-isolation.ts`), and a
 * best-effort stripper with a whole-block fallback is the right size of tool
 * for deciding where to paint.
 */

/** Stands in for an escaped character while the marker stripper runs; a Unicode private-use code point, so no document text can collide with it. */
const PLACEHOLDER = '\uE000';

export interface TextRange {
  readonly start: number;
  readonly end: number;
}

/**
 * A Markdown source slice as the render shows it. Best effort, by
 * construction: `[*_~\`]` are stripped wherever they stand, which is right
 * for a marker and wrong for an underscore inside `snake_case` — and the
 * `locateQuoteInText` step that follows is what covers the difference.
 */
export function visibleFormOf(source: string): string {
  // An escaped marker shows the marker, so it has to be taken out of the
  // text *before* the stripper below runs — otherwise `\*asterisk\*`
  // loses the asterisks it was escaping to keep. Each one stands aside as a
  // private-use placeholder and comes back at the end.
  const escaped: string[] = [];
  const held = source.replace(/\\([\\`*_{}[\]()#+\-.!~|<>])/g, (_match, char: string) => {
    escaped.push(char);
    return PLACEHOLDER;
  });

  const stripped = held
    // An image or inline link shows its label and not its target.
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    // The reference form, and a shortcut reference, likewise.
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, '$1')
    // Emphasis, strong, strikethrough and code — including a marker the
    // stored window cut in half, which is why this is not a paired match.
    .replace(/[*_~`]/g, '');

  let index = 0;
  return stripped.replaceAll(PLACEHOLDER, () => escaped[index++] ?? '');
}

/** Whitespace runs collapsed to one space, with a map from each collapsed index back to the original. */
function collapse(text: string): { readonly value: string; readonly indices: readonly number[] } {
  let value = '';
  const indices: number[] = [];
  let previousWasSpace = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (/\s/.test(char)) {
      if (previousWasSpace) continue;
      previousWasSpace = true;
      value += ' ';
      indices.push(index);
      continue;
    }
    previousWasSpace = false;
    value += char;
    indices.push(index);
  }
  return { value, indices };
}

/** The smallest `[start, end)` window of `text` holding `needle`'s non-space characters in order; earliest wins a tie. */
function smallestWindow(text: string, needle: string): TextRange | null {
  const wanted = needle.replace(/\s+/g, '');
  if (wanted.length === 0 || wanted.length > text.length) return null;
  let best: TextRange | null = null;
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== wanted[0]) continue;
    let cursor = start;
    let matched = 0;
    while (cursor < text.length && matched < wanted.length) {
      if (text[cursor] === wanted[matched]) matched++;
      cursor++;
    }
    // No window starting later can contain it either.
    if (matched < wanted.length) break;
    if (!best || cursor - start < best.end - best.start) best = { start, end: cursor };
  }
  return best;
}

/**
 * The span of `text` — a block's rendered `textContent` — that `quote`
 * names, or `null` when the block does not hold it at all.
 */
export function locateQuoteInText(text: string, quote: string): TextRange | null {
  const needle = visibleFormOf(quote).trim();
  if (needle.length === 0) return null;

  const direct = text.indexOf(needle);
  if (direct !== -1) return { start: direct, end: direct + needle.length };

  const haystack = collapse(text);
  const collapsedNeedle = collapse(needle).value;
  const loose = haystack.value.indexOf(collapsedNeedle);
  if (loose !== -1) {
    const start = haystack.indices[loose]!;
    const lastIndex = haystack.indices[loose + collapsedNeedle.length - 1]!;
    return { start, end: lastIndex + 1 };
  }

  return smallestWindow(text, needle);
}

/**
 * A DOM `Range` over the `[start, end)` characters of `block`'s text,
 * walking its text nodes in tree order — the order `textContent`
 * concatenates them in, so the offsets `locateQuoteInText` returned index
 * the same string. `null` when the block is too short to hold the range,
 * which is a stale measurement rather than an error: the article may have
 * been re-rendered between the threads response and this call.
 *
 * Nothing is written into the block. The cached HTML stays exactly as the
 * server sent it (comment-overlay spec: "The Client Composes Indicators
 * Onto Unchanged Cached HTML"), and the highlight is painted behind it from
 * this range's own rectangles.
 */
export function rangeOverOffsets(block: HTMLElement, start: number, end: number): Range | null {
  if (start < 0 || end <= start) return null;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let consumed = 0;
  let range: Range | null = null;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (range === null && consumed + length > start) {
      range = document.createRange();
      range.setStart(node, start - consumed);
    }
    if (range !== null && consumed + length >= end) {
      range.setEnd(node, end - consumed);
      return range;
    }
    consumed += length;
  }
  return null;
}

export interface Band {
  readonly top: number;
  readonly bottom: number;
}

/**
 * Whether the span has to be scrolled to. Word and Docs both scroll to a
 * comment's anchor only when it is not already in front of the reader;
 * scrolling text that is already on screen moves the document under someone
 * who was reading it.
 *
 * `viewport.top` is the bottom of the sticky contextual bar, not zero: a
 * span behind 56px of chrome is not visible even though its rect is inside
 * the window (docs/UI-CHECKLIST.md §6, "sticky headers and toolbars do not
 * obscure content"). A span taller than the band is scrolled to as well —
 * its top is what the reader needs.
 */
export function needsReveal(rect: Band, viewport: Band): boolean {
  return rect.top < viewport.top || rect.bottom > viewport.bottom;
}
