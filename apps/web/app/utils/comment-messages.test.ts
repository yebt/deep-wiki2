import { describe, expect, test } from 'vitest';
import { commentPosted, replyPosted, shortQuote, threadResolution } from './comment-messages';

/**
 * The four sentences the comment flow confirms itself with (owner request,
 * 2026-09-23: "Reply posted." must be a toast). They live in one module
 * because each is said **twice** — once in the panel's live region, which is
 * what a screen reader is reliably given, and once in the toast, which is
 * what a sighted person reads (docs/UI-CHECKLIST.md §4.12) — and two copies
 * of one sentence is the drift §4.1 exists to prevent.
 *
 * §4.12 also rules what they may say: "A toast says what happened to what.
 * 'Saved.' is §3's own example of a confirmation too weak to act on." So
 * every sentence names the thread by the text it is anchored to.
 */
describe('comment confirmations', () => {
  test('a short excerpt is quoted whole', () => {
    expect(shortQuote('The lock is soft.')).toBe('“The lock is soft.”');
  });

  test('a long excerpt is cut at a word boundary with an ellipsis, so a toast stays one sentence', () => {
    const quote = 'The soft lock is taken on entering edit mode and released when the editor closes or the heartbeat stops.';
    const short = shortQuote(quote);
    expect(short.length).toBeLessThanOrEqual(50);
    expect(short).toBe('“The soft lock is taken on entering edit…”');
    // Cut between words, never mid-word: a half word reads as a typo. The
    // kept head is therefore a prefix of the original that a space follows.
    const head = short.slice(1, -2);
    expect(quote.startsWith(`${head} `)).toBe(true);
  });

  test('an excerpt that is one very long word is still cut, rather than allowed to run', () => {
    const short = shortQuote('Unmaintainablesupercalifragilisticexpialidociousconfiguration');
    expect(short.length).toBeLessThanOrEqual(50);
    expect(short.endsWith('…”')).toBe(true);
  });

  test('an excerpt collapses its whitespace, because a block quote can span lines', () => {
    expect(shortQuote('The lock\n  is   soft.')).toBe('“The lock is soft.”');
  });

  test('each confirmation names what happened to what', () => {
    expect(commentPosted('The lock is soft.')).toBe('Comment posted on “The lock is soft.”.');
    expect(replyPosted('The lock is soft.')).toBe('Reply posted on “The lock is soft.”.');
    expect(threadResolution('The lock is soft.', true)).toBe('Thread resolved on “The lock is soft.”.');
    expect(threadResolution('The lock is soft.', false)).toBe('Thread reopened on “The lock is soft.”.');
  });

  test('a thread with no excerpt to name still says what happened, rather than quoting nothing', () => {
    expect(commentPosted('')).toBe('Comment posted.');
    expect(replyPosted('   ')).toBe('Reply posted.');
    expect(threadResolution('', true)).toBe('Thread resolved.');
  });
});
