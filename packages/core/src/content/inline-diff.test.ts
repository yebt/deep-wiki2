import { describe, expect, test } from 'bun:test';
import { diffInline, tokenizeInline } from './inline-diff';

/**
 * Word-level changes inside one edited block (block-diff spec: the block
 * classes stay; this is what an `edited` block shows *within* itself —
 * "a diff like GitHub's", owner review 2026-09-17). Pure: `packages/core`
 * has zero framework imports, so the tokenizer and the differ take
 * strings and return data.
 */
describe('tokenizeInline', () => {
  test('splits into words, whitespace runs and single punctuation marks, and loses nothing', () => {
    const text = 'The page, as it was — first saved.\n';
    const tokens = tokenizeInline(text);

    expect(tokens).toEqual(['The', ' ', 'page', ',', ' ', 'as', ' ', 'it', ' ', 'was', ' ', '—', ' ', 'first', ' ', 'saved', '.', '\n']);
    expect(tokens.join('')).toBe(text);
  });

  test('keeps digits and underscores inside a word, and treats each other symbol as its own token', () => {
    expect(tokenizeInline('snake_case_2 != v1.2')).toEqual(['snake_case_2', ' ', '!', '=', ' ', 'v1', '.', '2']);
  });

  test('an empty string has no tokens', () => {
    expect(tokenizeInline('')).toEqual([]);
  });

  test('non-Latin letters are words too', () => {
    expect(tokenizeInline('café naïve 日本語')).toEqual(['café', ' ', 'naïve', ' ', '日本語']);
  });
});

describe('diffInline', () => {
  test('a one-word substitution yields equal, deleted, inserted, equal', () => {
    expect(diffInline('the quick fox', 'the slow fox')).toEqual([
      { kind: 'equal', text: 'the ' },
      { kind: 'deleted', text: 'quick' },
      { kind: 'inserted', text: 'slow' },
      { kind: 'equal', text: ' fox' },
    ]);
  });

  test('the seeded fixture: a trailing phrase replaced, the shared prefix kept whole', () => {
    const before = 'The page as it was first saved, with no edits yet.';
    const after = 'The page as it was first saved, now with one small edit.';

    const segments = diffInline(before, after);

    expect(segments).toEqual([
      { kind: 'equal', text: 'The page as it was first saved, ' },
      { kind: 'inserted', text: 'now ' },
      { kind: 'equal', text: 'with ' },
      { kind: 'deleted', text: 'no edits yet' },
      { kind: 'inserted', text: 'one small edit' },
      { kind: 'equal', text: '.' },
    ]);
  });

  test('whitespace between two changed words is folded into the change, so a rewritten phrase is one mark per side', () => {
    expect(diffInline('keep a b c end', 'keep x y z end')).toEqual([
      { kind: 'equal', text: 'keep ' },
      { kind: 'deleted', text: 'a b c' },
      { kind: 'inserted', text: 'x y z' },
      { kind: 'equal', text: ' end' },
    ]);
  });

  test('the fold never produces a mark that is only whitespace', () => {
    // Two pure insertions around a common space: the space stays equal.
    const segments = diffInline('a b', 'x a b y');
    expect(segments.some((s) => s.kind !== 'equal' && /^\s+$/.test(s.text))).toBe(false);
    expect(segments.filter((s) => s.kind !== 'deleted').map((s) => s.text).join('')).toBe('x a b y');
  });

  test('both sides reassemble from their own segments — nothing is dropped or invented', () => {
    const before = 'Alpha beta, gamma; delta.\nEpsilon.';
    const after = 'Alpha gamma; delta! Zeta.\nEpsilon.';
    const segments = diffInline(before, after);

    const beforeText = segments.filter((s) => s.kind !== 'inserted').map((s) => s.text).join('');
    const afterText = segments.filter((s) => s.kind !== 'deleted').map((s) => s.text).join('');
    expect(beforeText).toBe(before);
    expect(afterText).toBe(after);
  });

  test('adjacent segments of one kind are merged, so a run of changed words is one mark', () => {
    const segments = diffInline('keep a b c end', 'keep x y z end');

    expect(segments.map((s) => s.kind)).not.toContainEqual(undefined);
    for (let i = 1; i < segments.length; i++) {
      expect(segments[i]!.kind).not.toBe(segments[i - 1]!.kind);
    }
  });

  test('identical text is one equal segment', () => {
    expect(diffInline('same', 'same')).toEqual([{ kind: 'equal', text: 'same' }]);
  });

  test('a pure insertion and a pure deletion', () => {
    expect(diffInline('', 'brand new')).toEqual([{ kind: 'inserted', text: 'brand new' }]);
    expect(diffInline('gone', '')).toEqual([{ kind: 'deleted', text: 'gone' }]);
  });

  test('two empty strings diff to nothing', () => {
    expect(diffInline('', '')).toEqual([]);
  });

  test('a change inside a word is the whole word, never a character diff', () => {
    expect(diffInline('colour', 'color')).toEqual([
      { kind: 'deleted', text: 'colour' },
      { kind: 'inserted', text: 'color' },
    ]);
  });

  test('is deterministic', () => {
    const a = 'One two three four five six.';
    const b = 'One two 3 four 5 six!';
    expect(diffInline(a, b)).toEqual(diffInline(a, b));
  });

  test('a large block finishes and still reassembles', () => {
    const before = Array.from({ length: 2000 }, (_, i) => `word${i}`).join(' ');
    const after = Array.from({ length: 2000 }, (_, i) => (i % 50 === 0 ? `changed${i}` : `word${i}`)).join(' ');
    const segments = diffInline(before, after);

    expect(segments.filter((s) => s.kind !== 'inserted').map((s) => s.text).join('')).toBe(before);
    expect(segments.filter((s) => s.kind !== 'deleted').map((s) => s.text).join('')).toBe(after);
    expect(segments.filter((s) => s.kind === 'deleted')).toHaveLength(40);
  });
});
