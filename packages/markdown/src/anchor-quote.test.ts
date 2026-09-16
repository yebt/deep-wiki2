import { describe, expect, test } from 'bun:test';
import { locateQuoteInBlock } from './anchor-quote';

/**
 * The client of `POST /pages/:id/comments` reads the page as cached HTML
 * and never sees the block's canonical source, so the text it selects is
 * *visible* text — `bold word`, not `**bold** word`. Save-time
 * reconciliation (`packages/db/src/comments/reconcile-comments.ts`)
 * compares the stored quote against the block's *source* by exact
 * substring first, so a quote that is not a source substring would fall
 * to trigram containment on every later save and could orphan a comment
 * on a block nobody touched. This module owns the one translation.
 */
describe('locateQuoteInBlock', () => {
  const source = 'Hello **world**, this is [a link](https://example.com) and more. ^abc123';

  test('an exact substring of the source anchors at its own offsets', () => {
    const anchor = locateQuoteInBlock(source, 'this is');
    expect(anchor).toEqual({ offsetStart: 17, offsetEnd: 24, quote: 'this is' });
    expect(source.slice(anchor.offsetStart, anchor.offsetEnd)).toBe(anchor.quote);
  });

  test('visible text that spans inline markup anchors to the smallest source window containing it, and the stored quote is that window', () => {
    const anchor = locateQuoteInBlock(source, 'Hello world');
    // The window closes on the last selected character, so the closing
    // `**` stays outside it; what matters is that the stored quote is a
    // source substring, which the exact-match rows of reconciliation need.
    expect(anchor).toEqual({ offsetStart: 0, offsetEnd: 13, quote: 'Hello **world' });
    expect(source.slice(anchor.offsetStart, anchor.offsetEnd)).toBe(anchor.quote);
  });

  test('visible link text anchors across the link syntax', () => {
    const anchor = locateQuoteInBlock(source, 'is a link and');
    expect(anchor.quote).toBe('is [a link](https://example.com) and');
    expect(source.slice(anchor.offsetStart, anchor.offsetEnd)).toBe(anchor.quote);
  });

  test('no quote anchors the whole block, without its trailing persisted anchor', () => {
    const anchor = locateQuoteInBlock(source, undefined);
    expect(anchor.quote).toBe('Hello **world**, this is [a link](https://example.com) and more.');
    expect(anchor.offsetStart).toBe(0);
    expect(anchor.offsetEnd).toBe(anchor.quote.length);
  });

  test('an empty or whitespace-only quote is the same as no quote', () => {
    expect(locateQuoteInBlock('Plain text.', '   ')).toEqual({ offsetStart: 0, offsetEnd: 11, quote: 'Plain text.' });
  });

  test('a quote that is not even a subsequence of the source falls back to the whole block', () => {
    expect(locateQuoteInBlock('Plain text.', 'zebra')).toEqual({ offsetStart: 0, offsetEnd: 11, quote: 'Plain text.' });
  });

  test('a quote that occurs more than once takes the occurrence nearest the hint, and the first without one', () => {
    const repeated = 'one two one two one';
    expect(locateQuoteInBlock(repeated, 'one')).toEqual({ offsetStart: 0, offsetEnd: 3, quote: 'one' });
    expect(locateQuoteInBlock(repeated, 'one', 9)).toEqual({ offsetStart: 8, offsetEnd: 11, quote: 'one' });
    expect(locateQuoteInBlock(repeated, 'one', 20)).toEqual({ offsetStart: 16, offsetEnd: 19, quote: 'one' });
  });

  test('surrounding whitespace on the selection is ignored', () => {
    expect(locateQuoteInBlock('Plain text here.', '  text  ')).toEqual({ offsetStart: 6, offsetEnd: 10, quote: 'text' });
  });

  test('the subsequence window is the smallest one — a later, tighter match beats an earlier, looser one', () => {
    // "ab" first occurs loosely as a…b across the whole string, and tightly at the end.
    const anchor = locateQuoteInBlock('a xxxxxx b ab', 'ab');
    expect(anchor).toEqual({ offsetStart: 11, offsetEnd: 13, quote: 'ab' });
  });
});
