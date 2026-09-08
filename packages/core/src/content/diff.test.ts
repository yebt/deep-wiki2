import { expect, test } from 'bun:test';
import type { BlockChange, BlockDiff } from './diff';

// versioning-and-collaboration design.md Decision 2 ("Where the diff
// lives") / block-diff spec: five mutually exclusive classifications, kept
// as a discriminated union on `kind` so each variant only carries the
// fields that make sense for it (e.g. only `modified` carries `moved`).

test('an added block names its slot and optional split origin', () => {
  const change: BlockChange = { kind: 'added', id: 'block-1', slot: 2, splitFrom: 'block-0' };

  expect(change.kind).toBe('added');
  expect(change.splitFrom).toBe('block-0');
});

test('a moved block carries both slots with no text implied', () => {
  const change: BlockChange = { kind: 'moved', id: 'block-1', fromSlot: 0, toSlot: 3 };

  expect(change.kind).toBe('moved');
  expect(change.fromSlot).toBe(0);
  expect(change.toSlot).toBe(3);
});

test('a BlockDiff is a flat, ordered list of changes', () => {
  const diff: BlockDiff = {
    changes: [
      { kind: 'unchanged', id: 'block-1', slot: 0 },
      { kind: 'removed', id: 'block-2', slot: 1, mergedInto: 'block-1' },
    ],
  };

  expect(diff.changes).toHaveLength(2);
  expect(diff.changes[1]).toEqual({ kind: 'removed', id: 'block-2', slot: 1, mergedInto: 'block-1' });
});
