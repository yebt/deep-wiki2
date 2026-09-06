import { describe, expect, test } from 'bun:test';
import { sliceBlocks } from './blocks';
import { parse } from './index';

// Shared block-slicing primitive consumed by both chunk() (chunk-golden.test.ts,
// chunk.test.ts) and packages/db's save-transaction block reconciliation
// (design.md "Block identity"; knowledge-graph/page-content specs). A single
// definition of "what counts as a top-level block" keeps both consumers from
// silently drifting apart.
describe('sliceBlocks()', () => {
  test('a block with no persisted anchor gets a null anchorId and a derived id', () => {
    const markdown = 'First paragraph.\n\nSecond paragraph.\n';
    const tree = parse(markdown);

    const blocks = sliceBlocks(tree, markdown);

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      expect(block.anchorId).toBeNull();
      expect(block.id.startsWith('d:')).toBe(true);
    }
  });

  test('a block carrying a persisted anchor reports that anchor as both its id and its anchorId', () => {
    const markdown = 'An anchored paragraph. ^abc123\n\nA plain one.\n';
    const tree = parse(markdown);

    const blocks = sliceBlocks(tree, markdown);

    expect(blocks[0]!.id).toBe('abc123');
    expect(blocks[0]!.anchorId).toBe('abc123');
    expect(blocks[1]!.anchorId).toBeNull();
  });

  test('identical unanchored sibling blocks get distinct derived ids via occurrence index', () => {
    const markdown = 'Repeat.\n\nRepeat.\n';
    const tree = parse(markdown);

    const blocks = sliceBlocks(tree, markdown);

    expect(blocks[0]!.id).not.toBe(blocks[1]!.id);
  });
});
