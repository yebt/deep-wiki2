import { describe, expect, test } from 'bun:test';
import { filterSlashCommands, reduceSlashState, SLASH_COMMANDS, INACTIVE_SLASH_STATE } from './slash-plugin';

// This file covers the PURE state machine only — filtering, the reducer,
// selection movement. The document MUTATIONS (each slash command's `run`,
// `insertMention`, and the single-undo-step guarantee) are exercised
// against a real EditorState in `mount/insertions.test.ts`.
// document-editor: Mention And Slash Menus Are Keyboard-First; Empty And
// No-Results States (the slash-menu half — mention-plugin.test.ts covers
// the shared reducer shape for @).
describe('filterSlashCommands', () => {
  test('an empty query returns every command (the empty-query state)', () => {
    expect(filterSlashCommands('')).toEqual(SLASH_COMMANDS);
  });

  test('filters by label, case-insensitively', () => {
    const results = filterSlashCommands('head');
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((c) => c.label.toLowerCase().includes('head'))).toBe(true);
  });

  test('a query matching nothing returns the distinct no-results state (an empty array)', () => {
    expect(filterSlashCommands('zzzzzzz')).toEqual([]);
  });
});

describe('reduceSlashState', () => {
  test('a trigger with no query shows every command, as render-facing summaries', () => {
    const next = reduceSlashState(INACTIVE_SLASH_STATE, { type: 'trigger', from: 0, to: 1, query: '' });
    expect(next.active).toBe(true);
    expect(next.commands.map((c) => c.id)).toEqual(SLASH_COMMANDS.map((c) => c.id));
    expect(next.commands[0]).not.toHaveProperty('run');
  });

  test('a query narrows the command list and resets selection', () => {
    const triggered = reduceSlashState(INACTIVE_SLASH_STATE, { type: 'trigger', from: 0, to: 1, query: '' });
    const withSelection = { ...triggered, selectedIndex: 3 };
    const next = reduceSlashState(withSelection, { type: 'trigger', from: 0, to: 6, query: 'quote' });
    expect(next.commands.every((c) => c.label.toLowerCase().includes('quote'))).toBe(true);
    expect(next.selectedIndex).toBe(0);
  });

  test('dismiss and no-trigger both deactivate', () => {
    const triggered = reduceSlashState(INACTIVE_SLASH_STATE, { type: 'trigger', from: 0, to: 1, query: '' });
    expect(reduceSlashState(triggered, { type: 'dismiss' }).active).toBe(false);
    expect(reduceSlashState(triggered, { type: 'noTrigger' }).active).toBe(false);
  });

  test('moveSelection wraps within the current command list', () => {
    const triggered = reduceSlashState(INACTIVE_SLASH_STATE, { type: 'trigger', from: 0, to: 1, query: '' });
    const movedUp = reduceSlashState(triggered, { type: 'moveSelection', delta: -1 });
    expect(movedUp.selectedIndex).toBe(triggered.commands.length - 1);
  });
});
