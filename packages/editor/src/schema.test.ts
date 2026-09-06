import { expect, test } from 'bun:test';
import { schema } from './schema';

// design.md "The ProseMirror schema and the three buckets" — bucket A is
// modelled directly; bucket B is carried verbatim as an opaque atom.

test('bucket A block nodes are all named by the schema', () => {
  for (const name of [
    'paragraph',
    'heading',
    'blockquote',
    'list',
    'listItem',
    'code',
    'thematicBreak',
    'table',
    'tableRow',
    'tableCell',
    'footnoteDefinition',
  ]) {
    expect(schema.nodes[name]).toBeDefined();
  }
});

test('bucket A inline nodes are all named by the schema', () => {
  for (const name of ['text', 'break', 'wikiLink', 'tag', 'footnoteReference']) {
    expect(schema.nodes[name]).toBeDefined();
  }
});

test('bucket A marks are all named by the schema', () => {
  for (const name of ['emphasis', 'strong', 'delete', 'inlineCode', 'link']) {
    expect(schema.marks[name]).toBeDefined();
  }
});

test('heading carries a level attribute', () => {
  const spec = schema.nodes.heading!.spec;
  expect(spec.attrs).toHaveProperty('level');
});

test('list carries ordered, start and spread attributes', () => {
  const spec = schema.nodes.list!.spec;
  expect(spec.attrs).toHaveProperty('ordered');
  expect(spec.attrs).toHaveProperty('start');
  expect(spec.attrs).toHaveProperty('spread');
});

test('every anchorable block node carries a blockAnchor attribute', () => {
  for (const name of ['paragraph', 'heading', 'listItem']) {
    expect(schema.nodes[name]!.spec.attrs).toHaveProperty('blockAnchor');
  }
});

test('the verbatim block atom carries raw source text and is not editable', () => {
  const verbatim = schema.nodes.verbatim!;

  expect(verbatim.isAtom).toBe(true);
  expect(verbatim.spec.selectable).not.toBe(false);
  expect(verbatim.spec.attrs).toHaveProperty('raw');
  expect(verbatim.spec.attrs).toHaveProperty('nodeType');
});

test('the verbatim inline atom is a distinct node from the block atom', () => {
  const inline = schema.nodes.verbatimInline!;

  expect(inline.isAtom).toBe(true);
  expect(inline.isInline).toBe(true);
  expect(inline.spec.attrs).toHaveProperty('raw');
});

test('a document can be constructed from a paragraph node', () => {
  const doc = schema.node('doc', null, [schema.node('paragraph', null, [schema.text('hello')])]);

  expect(doc.type.name).toBe('doc');
  expect(doc.textContent).toBe('hello');
});
