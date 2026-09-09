import { expect, test } from 'bun:test';
import { parse } from '../index';
import { collectWikiLinks } from './wiki-link';
import type { WikiLinkNode } from './wiki-link';

function findWikiLink(markdown: string, resolve?: (title: string) => { id: string } | undefined) {
  const tree = parse(markdown, { resolveWikiLink: resolve });
  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const node = paragraph.children.find((child) => child.type === 'wikiLink');
  if (!node) throw new Error('expected a wikiLink node');
  return node as unknown as WikiLinkNode;
}

// markdown-pipeline: Wiki-Link Parsing And Normalisation

test('plain wiki-link carries its raw target', () => {
  const node = findWikiLink('See [[Getting Started]] for more.');

  expect(node.target).toBe('Getting Started');
  expect(node.raw).toBe('[[Getting Started]]');
});

test('aliased wiki-link carries both the target and the alias', () => {
  const node = findWikiLink('See [[Getting Started|the guide]] for more.');

  expect(node.target).toBe('Getting Started');
  expect(node.alias).toBe('the guide');
});

test('anchored wiki-link carries the anchor segment', () => {
  const node = findWikiLink('See [[Getting Started#Installation]] for more.');

  expect(node.target).toBe('Getting Started');
  expect(node.anchor).toBe('Installation');
});

test('a resolvable target carries the resolved page identity', () => {
  const node = findWikiLink('See [[Getting Started]] for more.', (title) =>
    title === 'Getting Started' ? { id: 'page-123' } : undefined,
  );

  expect(node.resolved).toEqual({ id: 'page-123' });
});

test('an unresolvable target carries no resolved identity and keeps the raw text', () => {
  const node = findWikiLink('See [[Nonexistent Page]] for more.', () => undefined);

  expect(node.resolved).toBeUndefined();
  expect(node.raw).toBe('[[Nonexistent Page]]');
});

// knowledge-graph: Links Are Rebuilt, Not Patched, On Every Save

test('collectWikiLinks walks the whole tree in document order', () => {
  const tree = parse('See [[Target A]] and [[Target B|B]].\n\nAnother [[Target A]] here.\n');

  const links = collectWikiLinks(tree);

  expect(links.map((l) => l.target)).toEqual(['Target A', 'Target B', 'Target A']);
  expect(links[1]!.alias).toBe('B');
});

test('collectWikiLinks reports the owning block anchor when the block carries one, else null', () => {
  const tree = parse('Anchored paragraph with [[Target]]. ^abc123\n\nPlain paragraph with [[Other]].\n');

  const links = collectWikiLinks(tree);

  expect(links[0]!.sourceBlockId).toBe('abc123');
  expect(links[1]!.sourceBlockId).toBeNull();
});
