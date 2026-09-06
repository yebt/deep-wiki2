import { describe, expect, test } from 'bun:test';
import { deriveBlockId, matchBlocks, mintBlockId } from './match-blocks';

// markdown-pipeline: Block Split Assigns The Original ID / Block Merge Keeps
// One ID And Supersedes / Block Delete Tombstones The ID. design.md "Block
// identity" — Dice coefficient over token trigrams, τ = 0.5, ties break
// toward the earlier candidate. These are hand-authored representative edit
// sequences over the six named transformation classes (insert-above, split,
// merge, delete, reorder, edit-in-place) rather than a generated property
// suite — no property-testing library is part of this repo's toolchain yet.

const ORIGINAL = ['First paragraph about apples and oranges.', 'Second paragraph about bananas and pears.'];

function ids(previous: string[]): { id: string; text: string }[] {
  return previous.map((text, i) => ({ id: `id-${i}`, text }));
}

describe('matchBlocks: insert-above', () => {
  test('an unrelated block inserted before existing ones does not disturb their matches', () => {
    const previous = ids(ORIGINAL);
    const next = ['A brand new introduction.', ...ORIGINAL];

    const result = matchBlocks(previous, next);

    expect(result.assignments.find((a) => a.id === 'id-0')).toMatchObject({ status: 'active', slot: 1 });
    expect(result.assignments.find((a) => a.id === 'id-1')).toMatchObject({ status: 'active', slot: 2 });
  });
});

describe('matchBlocks: edit-in-place', () => {
  test('a small edit to a block keeps its persisted id active', () => {
    const previous = ids(ORIGINAL);
    const next = ['First paragraph about apples and oranges and grapes.', ORIGINAL[1]!];

    const result = matchBlocks(previous, next);

    expect(result.assignments.find((a) => a.id === 'id-0')).toMatchObject({ status: 'active', slot: 0 });
  });
});

describe('matchBlocks: split', () => {
  test('splitting a block hands the original id to the best-matching fragment and mints a fresh id for the other', () => {
    const previous = [{ id: 'id-0', text: 'Apples and oranges are tasty fruits, and bananas are also delicious.' }];
    const next = ['Apples and oranges are tasty fruits.', 'Bananas are also delicious.'];

    const result = matchBlocks(previous, next);

    const original = result.assignments.find((a) => a.id === 'id-0');
    expect(original).toMatchObject({ status: 'active' });

    const newFragmentAssignments = result.assignments.filter((a) => a.id !== 'id-0');
    expect(newFragmentAssignments).toHaveLength(1);
    expect(newFragmentAssignments[0]).toMatchObject({ status: 'active' });
    expect(newFragmentAssignments[0]!.id).not.toBe('id-0');

    // The two active assignments must land on two different slots.
    const slots = result.assignments.filter((a) => a.status === 'active').map((a) => a.slot);
    expect(new Set(slots).size).toBe(2);
  });
});

describe('matchBlocks: merge', () => {
  test('merging two blocks keeps the higher-scoring id and supersedes the other', () => {
    const previous = [
      { id: 'id-0', text: 'Apples and oranges are tasty fruits.' },
      { id: 'id-1', text: 'A completely different sentence about spacecraft engines.' },
    ];
    const next = ['Apples and oranges are tasty fruits, and bananas are also delicious.'];

    const result = matchBlocks(previous, next);

    const survivor = result.assignments.find((a) => a.id === 'id-0');
    expect(survivor).toMatchObject({ status: 'active', slot: 0 });

    const absorbed = result.assignments.find((a) => a.id === 'id-1');
    expect(absorbed?.status).toBe('tombstoned');
  });
});

describe('matchBlocks: delete', () => {
  test('a block with no remaining match is tombstoned, never left active below the threshold', () => {
    const previous = ids(ORIGINAL);
    const next = [ORIGINAL[0]!];

    const result = matchBlocks(previous, next);

    expect(result.assignments.find((a) => a.id === 'id-0')).toMatchObject({ status: 'active', slot: 0 });
    expect(result.assignments.find((a) => a.id === 'id-1')?.status).toBe('tombstoned');
  });
});

describe('matchBlocks: reorder', () => {
  test('swapping two blocks keeps each persisted id attached to its own content, not its old position', () => {
    const previous = ids(ORIGINAL);
    const next = [ORIGINAL[1]!, ORIGINAL[0]!];

    const result = matchBlocks(previous, next);

    expect(result.assignments.find((a) => a.id === 'id-0')).toMatchObject({ status: 'active', slot: 1 });
    expect(result.assignments.find((a) => a.id === 'id-1')).toMatchObject({ status: 'active', slot: 0 });
  });
});

describe('matchBlocks: threshold invariant', () => {
  test('no assignment is ever active below the threshold', () => {
    const previous = ids(ORIGINAL);
    const next = ['Completely unrelated content about spacecraft engines.', 'Also unrelated, about tax law.'];

    const result = matchBlocks(previous, next);

    for (const assignment of result.assignments) {
      expect(assignment.status === 'active' ? assignment.score >= 0.5 : true).toBe(true);
    }
    expect(result.assignments.every((a) => a.status !== 'active')).toBe(true);
  });
});

describe('deriveBlockId', () => {
  test('is stable for the same content and occurrence index', () => {
    const a = deriveBlockId('some block text', 0);
    const b = deriveBlockId('some block text', 0);

    expect(a).toBe(b);
    expect(a).toMatch(/^d:[0-9a-f]{12}#0$/);
  });

  test('differs for a different occurrence index of identical content', () => {
    const first = deriveBlockId('duplicate text', 0);
    const second = deriveBlockId('duplicate text', 1);

    expect(first).not.toBe(second);
  });
});

describe('mintBlockId', () => {
  test('mints a 10-character Crockford base32 id, unique against the given registry', () => {
    const existing = new Set(['AAAAAAAAAA']);

    const minted = mintBlockId(existing);

    expect(minted).toHaveLength(10);
    expect(minted).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(existing.has(minted)).toBe(false);
  });
});
