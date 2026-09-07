import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import * as editorIndex from './index';

// design.md "Read mode never reaches the ProseMirror bundle", layer 1: the
// "." export names schema/classify/fromMarkdown/toMarkdown, and its own
// source text must never re-export "./mount" — a shared barrel is how this
// gets violated silently (D13).
test('the "." export exposes schema, classify, fromMarkdown and toMarkdown', () => {
  expect(editorIndex.schema).toBeDefined();
  expect(typeof editorIndex.classify).toBe('function');
  expect(typeof editorIndex.fromMarkdown).toBe('function');
  expect(typeof editorIndex.toMarkdown).toBe('function');
  expect(typeof editorIndex.probe).toBe('function');
});

test('index.ts never re-exports "./mount"', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  // Matches an actual import/export statement naming "./mount", not the
  // doc comment above that mentions it in prose.
  expect(/from\s+['"]\.\/mount['"]/.test(source)).toBe(false);
});
