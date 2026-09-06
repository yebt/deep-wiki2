import { expect, test } from 'bun:test';
import { buildBlockIndex } from './block-index';
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
