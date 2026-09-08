import { describe, expect, test } from 'bun:test';
import { deriveBlockId, MATCH_THRESHOLD, matchBlocks, mintBlockId } from './match-blocks';

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

  // versioning-and-collaboration page-content spec: "Page Blocks Record
  // Split Provenance" — the minted fragment's origin must be exposed on
  // the result, not merely derivable from adjacency by the caller.
  test('the minted fragment names the surviving original as its split origin', () => {
    const previous = [{ id: 'id-0', text: 'Apples and oranges are tasty fruits, and bananas are also delicious.' }];
    const next = ['Apples and oranges are tasty fruits.', 'Bananas are also delicious.'];

    const result = matchBlocks(previous, next);

    expect(result.mintedIds).toHaveLength(1);
    expect(result.mintedIds[0]!.splitFrom).toBe('id-0');
  });
});

describe('matchBlocks: merge', () => {
  test('merging two blocks keeps the higher-scoring id and supersedes the other', () => {
    // Two distinct previous blocks, each still sharing enough vocabulary
    // with the single merged next block to individually clear
    // MATCH_THRESHOLD (0.58 and 0.64) — this is what actually drives both
    // into the same claimed slot and into the merge branch (`claimantsBySlot`
    // in match-blocks.ts), unlike a fixture where one side scores 0 and
    // never reaches that branch at all.
    const previous = [
      { id: 'id-0', text: 'Apples and oranges are tasty fruits, sweet and juicy.' },
      { id: 'id-1', text: 'Bananas are also delicious and pair nicely with warm spices.' },
    ];
    const next = [
      'Apples and oranges are tasty fruits, sweet and juicy, Bananas are also delicious and pair nicely with warm spices.',
    ];

    const result = matchBlocks(previous, next);

    // Sanity check this fixture genuinely lands both claimants on the same
    // slot, above threshold — i.e. it actually reaches the merge branch,
    // not just asserts the branch's expected shape.
    const claimedSlots = new Set(result.assignments.filter((a) => a.slot !== undefined).map((a) => a.slot));
    expect(claimedSlots.size).toBe(1);

    // id-1 scores higher (0.64) against the merged slot than id-0 (0.58),
    // so id-1 survives as the active id and id-0 is superseded by it.
    const survivor = result.assignments.find((a) => a.id === 'id-1');
    expect(survivor).toMatchObject({ status: 'active', slot: 0 });
    expect(survivor!.score).toBeGreaterThan(MATCH_THRESHOLD);

    const absorbed = result.assignments.find((a) => a.id === 'id-0');
    expect(absorbed).toMatchObject({ status: 'superseded', supersededBy: 'id-1' });
    expect(absorbed!.score).toBeGreaterThanOrEqual(MATCH_THRESHOLD);

    // The mapping resolves rather than pointing at nothing: `supersededBy`
    // names an id that is itself present, active, and occupying a real
    // slot — not a dangling reference to a superseded or tombstoned id.
    const resolved = result.assignments.find((a) => a.id === absorbed!.supersededBy);
    expect(resolved).toBeDefined();
    expect(resolved!.status).toBe('active');
    expect(resolved!.slot).toBe(0);
  });
});

describe('matchBlocks: tombstone despite a shared claimed slot', () => {
  test('a claimant whose own best score never reaches the threshold is tombstoned, not superseded, even when it shares a slot with a matched block', () => {
    // Distinct from `matchBlocks: delete` below (an ordinary orphan with no
    // matching content anywhere): here id-1's best slot happens to coincide
    // with id-0's, but id-1's own score against it never clears
    // MATCH_THRESHOLD, so it never becomes a merge claimant at all — the
    // threshold gate (`if (bestScore[i] < MATCH_THRESHOLD) return;`) routes
    // it straight to tombstoned instead. This is the fixture the old,
    // mislabeled "merge" test actually exercised.
    const previous = [
      { id: 'id-0', text: 'Apples and oranges are tasty fruits.' },
      { id: 'id-1', text: 'A completely different sentence about spacecraft engines.' },
    ];
    const next = ['Apples and oranges are tasty fruits, and bananas are also delicious.'];

    const result = matchBlocks(previous, next);

    const survivor = result.assignments.find((a) => a.id === 'id-0');
    expect(survivor).toMatchObject({ status: 'active', slot: 0 });

    const orphan = result.assignments.find((a) => a.id === 'id-1');
    expect(orphan?.status).toBe('tombstoned');
    expect(orphan?.supersededBy).toBeUndefined();
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
