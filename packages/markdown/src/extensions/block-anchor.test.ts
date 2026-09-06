import { expect, test } from 'bun:test';
import { canonicalise, parse } from '../index';

// markdown-pipeline: Block Index And In-Text Anchors Stay In Sync (parsing
// half); design.md "Persistence in markdown" — trailing ` ^id` produced by a
// micromark/mdast extension, represented as a `blockAnchor` mdast node.

function lastChild<T extends { children: unknown[] }>(node: T) {
  return node.children[node.children.length - 1];
}

test('a trailing block anchor parses to a blockAnchor node', () => {
  const tree = parse('A paragraph with a persisted anchor. ^abc123');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const anchor = lastChild(paragraph);

  expect(anchor).toMatchObject({ type: 'blockAnchor', id: 'abc123' });
});

test('the anchor is stripped from the preceding text run', () => {
  const tree = parse('A paragraph with a persisted anchor. ^abc123');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const text = paragraph.children[0];

  expect(text).toMatchObject({ type: 'text', value: 'A paragraph with a persisted anchor.' });
});

test('a block with no trailing anchor gets no blockAnchor node', () => {
  const tree = parse('Just an ordinary paragraph.');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');

  expect(paragraph.children.some((child) => child.type === 'blockAnchor')).toBe(false);
});

test('a real anchor round-trips byte-identical', () => {
  const markdown = 'A paragraph with a persisted anchor. ^abc123\n';

  expect(canonicalise(markdown)).toBe(markdown);
});

test('an escaped caret is preserved literally and is not read as an anchor', () => {
  const markdown = 'A literal caret at the end \\^notanid\n';

  const tree = parse(markdown);
  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');

  expect(paragraph.children.some((child) => child.type === 'blockAnchor')).toBe(false);
  expect(canonicalise(markdown)).toBe(markdown);
});
