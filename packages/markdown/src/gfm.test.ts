import { expect, test } from 'bun:test';
import { parse } from './index';

// markdown-pipeline: GFM And Custom Syntax Extensions Do Not Break CommonMark

test('table syntax parses with rows and alignment', () => {
  const tree = parse('| a | b |\n| --- | ---: |\n| 1 | 2 |\n');

  const table = tree.children[0];
  expect(table?.type).toBe('table');
  if (table?.type !== 'table') throw new Error('expected a table');
  expect(table.align).toEqual([null, 'right']);
  expect(table.children).toHaveLength(2); // header row + one body row
});

test('a plain markdown link still parses as a standard link with the wiki-link extension enabled', () => {
  const tree = parse('[text](https://example.com)');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const link = paragraph.children[0];

  expect(link?.type).toBe('link');
  if (link?.type !== 'link') throw new Error('expected a link');
  expect(link.url).toBe('https://example.com');
  expect(paragraph.children.some((child) => child.type === 'wikiLink')).toBe(false);
});
