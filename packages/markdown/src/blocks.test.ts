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

  // A list item is not top-level (it is nested two levels down: root ->
  // list -> listItem), so it is deliberately not its own block — the whole
  // list is. A persisted anchor written on a list item must not be
  // silently sliced as though it belonged to a block of its own; see
  // block-index.test.ts for the matching half of this (buildBlockIndex
  // must not index it either — the defect this pins was the two
  // disagreeing about exactly this document).
  test('a persisted anchor on a list item is not sliced as its own block — the whole list is one block', () => {
    const markdown = '- First item.\n- Second item. ^litem1\n- Third item.\n';
    const tree = parse(markdown);

    const blocks = sliceBlocks(tree, markdown);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.anchorId).toBeNull();
  });
});
