import { expect, test } from 'bun:test';
import { parse } from '../index';
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
