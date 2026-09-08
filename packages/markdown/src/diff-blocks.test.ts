import { describe, expect, test } from 'bun:test';
import type { BlockChange } from '@deep-wiki/core';
import { diffBlocks } from './diff-blocks';

// versioning-and-collaboration block-diff spec / design.md Decision 2
// ("Where the diff lives"). `diffBlocks` re-parses both sides fresh via
// `sliceBlocks(parse(...))` and calls `matchBlocks()` — it never reads a
// stored `block_index` column, and it never falls back to a line differ.

function changeFor(changes: readonly BlockChange[], kind: BlockChange['kind']): BlockChange[] {
  return changes.filter((c) => c.kind === kind);
}

describe('diffBlocks: added, removed, modified, moved', () => {
  test('an added paragraph with no matching id is reported as added, not also modified', () => {
    const before = 'First paragraph about apples and oranges.\n';
    const after = 'First paragraph about apples and oranges.\n\nA brand new second paragraph about kiwis.\n';

    const result = diffBlocks(before, after);

    const added = changeFor(result.changes, 'added');
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ kind: 'added', slot: 1 });
    expect(changeFor(result.changes, 'modified')).toHaveLength(0);
  });

  test('a byte-identical block that changed position is reported moved, not remove-plus-add', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';
    const after = 'Second paragraph about bananas and pears.\n\nFirst paragraph about apples and oranges.\n';

    const result = diffBlocks(before, after);

    expect(changeFor(result.changes, 'removed')).toHaveLength(0);
    expect(changeFor(result.changes, 'added')).toHaveLength(0);
    const moved = changeFor(result.changes, 'moved');
    expect(moved).toHaveLength(2);
    const firstMove = moved.find((c) => c.kind === 'moved' && c.fromSlot === 0);
    expect(firstMove).toMatchObject({ kind: 'moved', fromSlot: 0, toSlot: 1 });
  });

  test('a block that keeps its slot but changes text is reported modified, not moved', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';
    const after = 'First paragraph about apples and oranges and grapes now too.\n\nSecond paragraph about bananas and pears.\n';

    const result = diffBlocks(before, after);

    const modified = changeFor(result.changes, 'modified');
    expect(modified).toHaveLength(1);
    expect(modified[0]).toMatchObject({ kind: 'modified', fromSlot: 0, toSlot: 0, moved: false });
    expect(changeFor(result.changes, 'moved')).toHaveLength(0);
  });

  test('a removed paragraph with no surviving match is reported removed, with no mergedInto', () => {
    const before = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';
    const after = 'First paragraph about apples and oranges.\n';

    const result = diffBlocks(before, after);

    const removed = changeFor(result.changes, 'removed');
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatchObject({ kind: 'removed', slot: 1 });
    expect((removed[0] as { mergedInto?: string }).mergedInto).toBeUndefined();
  });
});

// versioning-and-collaboration tasks.md 4.2: a fixture where NOTHING moved
// must classify every block `unchanged` — asserted explicitly rather than
// inferred from the added/removed fixtures above, since a trivial no-op
// diff would pass any moved-handling code that never actually ran.
describe('diffBlocks: no-op input never classifies as moved', () => {
  test('an unedited document classifies every block unchanged, never moved', () => {
    const markdown = 'First paragraph about apples and oranges.\n\nSecond paragraph about bananas and pears.\n';

    const result = diffBlocks(markdown, markdown);

    expect(changeFor(result.changes, 'moved')).toHaveLength(0);
    expect(changeFor(result.changes, 'modified')).toHaveLength(0);
    expect(changeFor(result.changes, 'added')).toHaveLength(0);
    expect(changeFor(result.changes, 'removed')).toHaveLength(0);
    const unchanged = changeFor(result.changes, 'unchanged');
    expect(unchanged).toHaveLength(2);
    expect(unchanged.map((c) => (c.kind === 'unchanged' ? c.slot : -1)).sort()).toEqual([0, 1]);
  });
});

// versioning-and-collaboration tasks.md 4.3: matchBlocks() mints split ids
// via crypto.getRandomValues (match-blocks.ts), so a naive diffBlocks that
// reported those ids verbatim would be nondeterministic across runs. This
// fixture specifically triggers a split (mints an id) and must fail before
// the fix discards mintedIds' identifiers and reports after's own
// sliceBlocks id at that slot instead.
describe('diffBlocks: determinism across repeated runs, including a split', () => {
  test('diffing the same split-producing input twice yields byte-identical output', () => {
    const before = 'Apples and oranges are tasty fruits, and bananas are also delicious. ^abc123\n';
    const after = 'Apples and oranges are tasty fruits.\n\nBananas are also delicious.\n';

    const first = diffBlocks(before, after);
    const second = diffBlocks(before, after);

    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const added = changeFor(first.changes, 'added');
    expect(added).toHaveLength(1);
    expect((added[0] as { splitFrom?: string }).splitFrom).toBe('abc123');
  });
});

// versioning-and-collaboration tasks.md 4.4: a fully unanchored document
// (sliceBlocks returns records with no anchorId) must still diff
// correctly end to end — this fails against any implementation that reads
// `page_revision.block_index` (an anchor-only subset) instead of
// re-parsing fresh.
describe('diffBlocks: a fully unanchored document diffs correctly', () => {
  test('every block is derived-id only, and the diff still reports the real edit', () => {
    const before = 'Completely unanchored first paragraph with no persisted id at all.\n';
    const after = 'Completely unanchored first paragraph with no persisted id at all, extended.\n';

    const result = diffBlocks(before, after);

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({ kind: 'modified', fromSlot: 0, toSlot: 0 });
  });
});

// versioning-and-collaboration tasks.md 4.9: the diff must work directly
// between non-adjacent revisions, not as a composition of intermediate
// diffs. A block edited away and then reverted nets to `unchanged`
// end-to-end, but a naive composition of consecutive diffs would show two
// `modified` entries instead — this is the disagreement that proves
// direct computation, not composition, drives the result.
describe('diffBlocks: works directly between non-adjacent revisions', () => {
  test('a block reverted to its original text nets to unchanged end to end', () => {
    const revision1 = 'The original wording of this paragraph. ^stable1\n';
    const revision2 = 'A temporarily different wording of this paragraph. ^stable1\n';
    const revision5 = 'The original wording of this paragraph. ^stable1\n';

    const direct = diffBlocks(revision1, revision5);
    expect(direct.changes).toHaveLength(1);
    expect(direct.changes[0]).toMatchObject({ kind: 'unchanged', slot: 0 });

    // A naive composition of the two intermediate diffs would instead
    // report two `modified` entries — the disagreement direct computation
    // must avoid.
    const stepOne = diffBlocks(revision1, revision2);
    const stepTwo = diffBlocks(revision2, revision5);
    expect(changeFor(stepOne.changes, 'modified')).toHaveLength(1);
    expect(changeFor(stepTwo.changes, 'modified')).toHaveLength(1);
  });
});
