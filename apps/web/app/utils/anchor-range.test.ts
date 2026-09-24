import { describe, expect, test } from 'vitest';
import { locateQuoteInText, needsReveal, rangeOverOffsets, visibleFormOf } from './anchor-range';

/**
 * Where a comment's anchored text sits in the rendered block — the mapping
 * behind the highlight the owner asked for on 2026-09-23 ("no me muestra muy
 * bien la relación … Guíate en Word o Google Docs": both products highlight
 * the exact span, not the whole paragraph).
 *
 * The hard part is that the two sides are in different alphabets. A stored
 * anchor's `quote` is a slice of the block's **Markdown source**
 * (`locateQuoteInBlock` in `packages/markdown`, which stores a source
 * substring on purpose so save-time reconciliation can match it exactly),
 * and what the reader sees is the **rendered** text — `bold word` where the
 * source says `**bold** word`. A window of the source can even carry half a
 * marker: `Hello **world` is what gets stored for a selection of `Hello
 * world` over `Hello **world**`. Every case below is one of those.
 */
describe('visibleFormOf', () => {
  test('drops emphasis, strong, strikethrough and code markers', () => {
    expect(visibleFormOf('**bold** and _thin_ and ~~gone~~ and `code`')).toBe('bold and thin and gone and code');
  });

  test('drops a marker the stored window cut in half', () => {
    // What `locateQuoteInBlock` stores for a selection of "Hello world"
    // made over the source `Hello **world**`.
    expect(visibleFormOf('Hello **world')).toBe('Hello world');
  });

  test('keeps a link’s label and drops its target, as the render does', () => {
    expect(visibleFormOf('see [the handbook](https://example.test/h) for more')).toBe('see the handbook for more');
    expect(visibleFormOf('![a diagram](/d.png) follows')).toBe('a diagram follows');
    expect(visibleFormOf('see [the handbook][hb]')).toBe('see the handbook');
  });

  test('an escaped character is the character itself', () => {
    expect(visibleFormOf('a literal \\*asterisk\\* here')).toBe('a literal *asterisk* here');
  });
});

describe('locateQuoteInText', () => {
  test('finds a quote that survives rendering unchanged', () => {
    const text = 'The soft lock is taken on entering edit mode.';
    expect(locateQuoteInText(text, 'taken on entering')).toEqual({ start: 17, end: 34 });
  });

  test('finds a quote whose markers the render removed', () => {
    const text = 'The soft lock is taken on entering edit mode.';
    expect(locateQuoteInText(text, '**taken** on _entering_')).toEqual({ start: 17, end: 34 });
  });

  test('a whole-block anchor covers the whole block, which is the honest span for it', () => {
    const text = 'The soft lock is taken on entering edit mode.';
    expect(locateQuoteInText(text, 'The soft lock is taken on entering edit mode.')).toEqual({ start: 0, end: text.length });
  });

  test('matches across a line break the source spelled and the render kept', () => {
    // A soft break inside a paragraph is a newline in both, but a source
    // window may hold two spaces where the render holds one, and vice versa.
    const text = 'The soft lock\nis taken on entering edit mode.';
    expect(locateQuoteInText(text, 'soft lock is taken')).toEqual({ start: 4, end: 22 });
  });

  test('falls back to the smallest window that holds the quote’s characters in order', () => {
    // `snake_case` loses its underscore to the marker stripper, so no exact
    // match exists; the window that does hold those characters is the word.
    const text = 'Rename snake_case to camelCase.';
    expect(locateQuoteInText(text, 'snake_case')).toEqual({ start: 7, end: 17 });
  });

  test('gives up rather than guessing when the text does not hold the quote at all', () => {
    expect(locateQuoteInText('A paragraph about something else entirely.', 'the soft lock')).toBeNull();
    expect(locateQuoteInText('Some text.', '')).toBeNull();
    expect(locateQuoteInText('Short.', 'a quote far longer than the block it claims to be inside of')).toBeNull();
  });
});

describe('rangeOverOffsets', () => {
  function block(html: string): HTMLElement {
    const element = document.createElement('p');
    element.innerHTML = html;
    document.body.append(element);
    return element;
  }

  test('spans the characters asked for, across the elements the render nested', () => {
    const element = block('The <strong>soft</strong> lock is taken.');
    // "soft lock" — starts inside <strong>, ends in the trailing text node.
    const range = rangeOverOffsets(element, 4, 13)!;
    expect(range.toString()).toBe('soft lock');
  });

  test('spans a range wholly inside one nested element', () => {
    const element = block('The <em>soft lock</em> is taken.');
    expect(rangeOverOffsets(element, 4, 8)!.toString()).toBe('soft');
  });

  test('returns nothing for a range the block is too short to hold', () => {
    const element = block('Short.');
    expect(rangeOverOffsets(element, 2, 99)).toBeNull();
  });
});

describe('needsReveal', () => {
  // Word and Docs both scroll the anchor into view only when it is not
  // already in front of the reader; scrolling text that is already on screen
  // moves the document under someone who was reading it.
  test('says nothing needs doing when the span is already in front of the reader', () => {
    expect(needsReveal({ top: 300, bottom: 340 }, { top: 56, bottom: 900 })).toBe(false);
  });

  test('says so when the span is below the fold, above it, or taller than the window', () => {
    expect(needsReveal({ top: 950, bottom: 990 }, { top: 56, bottom: 900 })).toBe(true);
    expect(needsReveal({ top: 10, bottom: 50 }, { top: 56, bottom: 900 })).toBe(true);
    expect(needsReveal({ top: 40, bottom: 1200 }, { top: 56, bottom: 900 })).toBe(true);
  });

  // The sticky contextual bar is 56px of chrome over the top of the pane
  // (docs/DESIGN-SYSTEM.md §9.3), so a span behind it is not visible even
  // though its rect is inside the viewport (docs/UI-CHECKLIST.md §6, "sticky
  // headers do not obscure content when navigating to an anchor").
  test('treats a span behind the sticky bar as off screen', () => {
    expect(needsReveal({ top: 20, bottom: 48 }, { top: 56, bottom: 900 })).toBe(true);
  });
});
