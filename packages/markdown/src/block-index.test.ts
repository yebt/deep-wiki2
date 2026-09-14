import { expect, test } from 'bun:test';
import { buildBlockIndex } from './block-index';
import { sliceBlocks } from './blocks';
import { parse } from './index';

// markdown-pipeline: Block Index And In-Text Anchors Stay In Sync — the
// index must reflect every persisted anchor, and every persisted anchor
// must appear in the index, both directions.

test('a persisted anchor produces an entry in the block index', () => {
  const markdown = 'A paragraph with a persisted anchor. ^abc123\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);

  expect(index['abc123']).toBeDefined();
  expect(index['abc123']).toMatchObject({ start: 0 });
});

test('a document with no anchors produces an empty index', () => {
  const markdown = 'Just an ordinary paragraph, nothing anchored.\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);

  expect(Object.keys(index)).toHaveLength(0);
});

test('every anchor in the text has a matching index entry, and vice versa', () => {
  const markdown = 'First anchored paragraph. ^first\n\nSecond anchored paragraph. ^second\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);

  expect(Object.keys(index).sort()).toEqual(['first', 'second']);
});

test('the index entry span can be sliced back out of the source to reach the owning block', () => {
  const markdown = 'A persisted paragraph. ^xyz789\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);
  const entry = index['xyz789']!;

  expect(markdown.slice(entry.start, entry.end)).toContain('A persisted paragraph.');
});

// The named defect: buildBlockIndex used to walk the whole tree (visit()),
// finding an anchor on a list item, while sliceBlocks walks only
// tree.children and never sees it — the same fact (which anchors exist) in
// two places with nothing keeping them in agreement. A list-item anchor
// landed in page_content.block_index but never got a page_blocks row.
//
// A list item is not top-level, so a persisted anchor written on one is
// deliberately never entered into the block index — matching sliceBlocks,
// which deliberately never gives it a BlockSlice of its own (blocks.test.ts).
test('a persisted anchor on a list item produces no block-index entry — list items are not top-level blocks', () => {
  const markdown = '- First item.\n- Second item. ^litem1\n- Third item.\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);

  expect(index['litem1']).toBeUndefined();
});

test('buildBlockIndex and sliceBlocks agree on exactly the same set of persisted anchor ids', () => {
  const markdown =
    'Top-level anchored paragraph. ^toplevel\n\n- First item.\n- Second item. ^litem1\n- Third item.\n';
  const tree = parse(markdown);

  const index = buildBlockIndex(tree, markdown);
  const blocks = sliceBlocks(tree, markdown);

  const indexedIds = Object.keys(index).sort();
  const slicedAnchorIds = blocks
    .map((block) => block.anchorId)
    .filter((id): id is string => id !== null)
    .sort();

  expect(indexedIds).toEqual(slicedAnchorIds);
});
