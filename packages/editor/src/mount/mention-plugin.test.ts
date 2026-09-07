import { describe, expect, test } from 'bun:test';
import { moveSelection, reduceMentionState, type MentionCandidate, INACTIVE_MENTION_STATE } from './mention-plugin';

const CANDIDATES: MentionCandidate[] = [
  { id: '1', type: 'user', label: 'Alice' },
  { id: '2', type: 'user', label: 'Alice B' },
  { id: '3', type: 'page', label: 'Alice in Wonderland' },
];

// document-editor: Mention And Slash Menus Are Keyboard-First; Empty And
// No-Results States; the active-item selection half.
describe('reduceMentionState', () => {
  test('becomes active with an empty candidate list on a fresh trigger (the empty-query state)', () => {
    const next = reduceMentionState(INACTIVE_MENTION_STATE, { type: 'trigger', from: 5, to: 6, query: '' });
    expect(next.active).toBe(true);
    expect(next.query).toBe('');
    expect(next.candidates).toEqual([]);
    expect(next.selectedIndex).toBe(0);
  });

  test('updates the query and resets selection while staying active', () => {
    const triggered = reduceMentionState(INACTIVE_MENTION_STATE, { type: 'trigger', from: 5, to: 6, query: '' });
    const withSelection = { ...triggered, candidates: CANDIDATES, selectedIndex: 2 };
    const next = reduceMentionState(withSelection, { type: 'trigger', from: 5, to: 9, query: 'ali' });
    expect(next.query).toBe('ali');
    expect(next.selectedIndex).toBe(0);
  });

  test('setting candidates does not change the active query or reset the selection', () => {
    const triggered = reduceMentionState(INACTIVE_MENTION_STATE, { type: 'trigger', from: 5, to: 8, query: 'al' });
    const next = reduceMentionState(triggered, { type: 'setCandidates', candidates: CANDIDATES });
    expect(next.candidates).toBe(CANDIDATES);
    expect(next.active).toBe(true);
    expect(next.selectedIndex).toBe(0);
  });

  test('an empty candidate list after a query is the distinct no-results state (active, non-empty query, zero candidates)', () => {
    const triggered = reduceMentionState(INACTIVE_MENTION_STATE, { type: 'trigger', from: 5, to: 10, query: 'zzzz' });
    const next = reduceMentionState(triggered, { type: 'setCandidates', candidates: [] });
    expect(next.active).toBe(true);
    expect(next.query).toBe('zzzz');
    expect(next.candidates).toEqual([]);
  });

  test('dismiss and no-trigger both deactivate', () => {
    const triggered = reduceMentionState(INACTIVE_MENTION_STATE, { type: 'trigger', from: 5, to: 6, query: '' });
    expect(reduceMentionState(triggered, { type: 'dismiss' }).active).toBe(false);
    expect(reduceMentionState(triggered, { type: 'noTrigger' }).active).toBe(false);
  });
});

describe('moveSelection', () => {
  test('wraps forward past the last candidate to the first', () => {
    expect(moveSelection(2, 1, CANDIDATES.length)).toBe(0);
  });

  test('wraps backward past the first candidate to the last', () => {
    expect(moveSelection(0, -1, CANDIDATES.length)).toBe(2);
  });

  test('moves within bounds normally', () => {
    expect(moveSelection(0, 1, CANDIDATES.length)).toBe(1);
  });

  test('is a no-op (stays 0) with zero candidates', () => {
    expect(moveSelection(0, 1, 0)).toBe(0);
  });
});
