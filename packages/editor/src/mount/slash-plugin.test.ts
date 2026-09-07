import { describe, expect, test } from 'bun:test';
import { filterSlashCommands, reduceSlashState, SLASH_COMMANDS, INACTIVE_SLASH_STATE } from './slash-plugin';

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
  test('a trigger with no query shows every command', () => {
    const next = reduceSlashState(INACTIVE_SLASH_STATE, { type: 'trigger', from: 0, to: 1, query: '' });
    expect(next.active).toBe(true);
    expect(next.commands).toEqual(SLASH_COMMANDS);
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
});
