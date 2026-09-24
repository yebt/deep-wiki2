import { describe, expect, test } from 'vitest';
import { shortcutsSentence, type KeyboardShortcut } from './useKeyboardShortcuts';

/**
 * The sentence a screen reader is given is derived from the list a sighted
 * person reads, so the two cannot drift (docs/UI-CHECKLIST.md §4.1: a
 * second copy of the same facts is a defect even while the copies agree).
 */
const SHORTCUTS: KeyboardShortcut[] = [
  { keys: ['↑', '↓'], spoken: 'The up and down arrows', description: 'move through the tree' },
  { keys: ['Alt', '↑', '↓'], spoken: 'Alt with the arrow keys', description: 'moves an item among its siblings' },
];

describe('shortcutsSentence', () => {
  test('says every chord out loud, in the list’s own order', () => {
    expect(shortcutsSentence(SHORTCUTS)).toBe(
      'The up and down arrows move through the tree; Alt with the arrow keys moves an item among its siblings.',
    );
  });

  test('carries no arrow glyph: a screen reader reads the spoken spelling, never the drawn one', () => {
    expect(shortcutsSentence(SHORTCUTS)).not.toMatch(/[↑↓←→]/);
  });

  test('every entry reaches the sentence, so a key named in the list can never be missing from it', () => {
    const sentence = shortcutsSentence(SHORTCUTS);
    for (const shortcut of SHORTCUTS) {
      expect(sentence).toContain(shortcut.spoken);
      expect(sentence).toContain(shortcut.description);
    }
  });

  test('an empty list is an empty sentence, not a stray full stop', () => {
    expect(shortcutsSentence([])).toBe('');
  });
});
