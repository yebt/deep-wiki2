import { describe, expect, test } from 'vitest';
import { insertMention, mentionQueryAt, mentionedIdsIn } from './mention-trigger';

/**
 * The `@` trigger for a plain textarea — the comment composer's half of
 * what `packages/editor/src/mount/trigger.ts` does for ProseMirror. Pure,
 * so the composer's keyboard behaviour is held here without a DOM.
 */
describe('mentionQueryAt', () => {
  test('an @ at the start or after whitespace, up to the caret, is a query', () => {
    expect(mentionQueryAt('@an', 3)).toEqual({ from: 0, to: 3, query: 'an' });
    expect(mentionQueryAt('hello @an', 9)).toEqual({ from: 6, to: 9, query: 'an' });
    expect(mentionQueryAt('hello @', 7)).toEqual({ from: 6, to: 7, query: '' });
  });

  test('an @ inside a word, or one the caret has left, is not a query', () => {
    expect(mentionQueryAt('mail@example', 12)).toBeNull();
    expect(mentionQueryAt('@ana done', 9)).toBeNull();
    expect(mentionQueryAt('@ana', 2)).toEqual({ from: 0, to: 2, query: 'a' });
  });

  test('a query never spans whitespace or a second @', () => {
    expect(mentionQueryAt('@ana bravo', 10)).toBeNull();
    expect(mentionQueryAt('@a@b', 4)).toBeNull();
  });
});

describe('insertMention', () => {
  test('replaces the query with @label and a space, and puts the caret after it', () => {
    expect(insertMention('hello @an, ok', { from: 6, to: 9 }, 'Ana Lima')).toEqual({ text: 'hello @Ana Lima , ok', caret: 16 });
  });
});

describe('mentionedIdsIn', () => {
  test('keeps only the confirmed mentions whose @label still stands in the text, once each', () => {
    const confirmed = [
      { id: 'u1', label: 'Ana Lima' },
      { id: 'u2', label: 'Ben' },
      { id: 'u1', label: 'Ana Lima' },
    ];
    expect(mentionedIdsIn('cc @Ana Lima and @Ben', confirmed)).toEqual(['u1', 'u2']);
    expect(mentionedIdsIn('cc @Ana Lima only', confirmed)).toEqual(['u1']);
    expect(mentionedIdsIn('nobody', confirmed)).toEqual([]);
  });
});
