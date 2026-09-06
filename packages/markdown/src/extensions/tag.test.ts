import { expect, test } from 'bun:test';
import { parse } from '../index';

// markdown-pipeline: Tag Parsing

test('a #tag in body text is parsed as a distinct tag construct', () => {
  const tree = parse('This page is #important reading.');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const tag = paragraph.children.find((child) => child.type === 'tag');

  expect(tag).toBeDefined();
  expect((tag as unknown as { name: string }).name).toBe('important');
});

test('a # heading and a separate #tag are recognised as distinct constructs', () => {
  const tree = parse('# Heading\n\nBody with a #tag in it.');

  const heading = tree.children[0];
  const paragraph = tree.children[1];
  expect(heading?.type).toBe('heading');
  if (heading?.type !== 'heading') throw new Error('expected a heading');
  // The heading's own text must not have become a tag.
  expect(heading.children.some((child) => child.type === 'tag')).toBe(false);

  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  expect(paragraph.children.some((child) => child.type === 'tag')).toBe(true);
});

test('a # inside inline code is not parsed as a tag', () => {
  const tree = parse('Use `#include` in C.');

  const paragraph = tree.children[0];
  if (paragraph?.type !== 'paragraph') throw new Error('expected a paragraph');
  const inlineCode = paragraph.children.find((child) => child.type === 'inlineCode');

  expect(inlineCode).toBeDefined();
  if (inlineCode?.type !== 'inlineCode') throw new Error('expected inline code');
  expect(inlineCode.value).toBe('#include');
  expect(paragraph.children.some((child) => child.type === 'tag')).toBe(false);
});
