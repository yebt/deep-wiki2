import { describe, expect, test } from 'bun:test';
import { schema, TASK_CHECKBOX_LABEL } from './schema';

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

/**
 * A regression guard for the exact failure mounting a real `EditorView`
 * (behind `"./mount"`) throws when it is missing:
 * `node.type.spec.toDOM is not a function`. GATE-2 only exercises
 * `fromMarkdown`/`toMarkdown`, never DOM serialization, so a node without
 * `toDOM` could pass every existing test here and still crash the first
 * time a real editor tries to render it — this test is what would have
 * caught that before WU-16's mount surface did, at runtime, in a browser.
 */
test('every node and mark other than doc/text declares toDOM', () => {
  for (const [name, type] of Object.entries(schema.nodes)) {
    if (name === 'doc' || name === 'text') continue;
    expect(typeof type.spec.toDOM, `node "${name}" has no toDOM`).toBe('function');
  }
  for (const [name, type] of Object.entries(schema.marks)) {
    expect(typeof type.spec.toDOM, `mark "${name}" has no toDOM`).toBe('function');
  }
});

// The owner's 2026-09-23 report: a task list was invisible as one. A task
// item rendered as a plain `<li>` carrying a `data-checked` attribute that
// no stylesheet read, so `- [ ] a` and `- a` drew identically and there was
// no box to click. The shape below is `mdast-util-to-hast`'s own task-item
// markup, so one set of `.doc-body` rules dresses read mode and edit mode
// alike.
describe('listItem.toDOM', () => {
  function render(checked: boolean | null): unknown {
    const item = schema.nodes.listItem!.create({ checked }, schema.nodes.paragraph!.create());
    return schema.nodes.listItem!.spec.toDOM!(item);
  }

  test('a plain bullet item is a bare <li> with the content hole and nothing else', () => {
    expect(render(null)).toEqual(['li', 0]);
  });

  test('an unchecked task item renders an unchecked checkbox before its content', () => {
    expect(render(false)).toEqual([
      'li',
      { class: 'task-list-item', 'data-checked': 'false' },
      ['input', { type: 'checkbox', contenteditable: 'false', tabindex: '-1', 'aria-label': TASK_CHECKBOX_LABEL, title: TASK_CHECKBOX_LABEL }],
      ['div', { class: 'task-list-item-content' }, 0],
    ]);
  });

  test('a checked task item renders a checked checkbox', () => {
    expect(render(true)).toEqual([
      'li',
      { class: 'task-list-item', 'data-checked': 'true' },
      [
        'input',
        {
          type: 'checkbox',
          contenteditable: 'false',
          tabindex: '-1',
          'aria-label': TASK_CHECKBOX_LABEL,
          title: TASK_CHECKBOX_LABEL,
          checked: 'checked',
        },
      ],
      ['div', { class: 'task-list-item-content' }, 0],
    ]);
  });

  test('the box names itself and the keystroke that flips it', () => {
    // §5: a pointer-only manipulation's keyboard equivalent has to be named
    // in the UI, not only in a comment. The box is not a tab stop, so the
    // keystroke is the keyboard route and the box is where it is named.
    const rendered = render(false) as [string, object, [string, Record<string, string>], unknown];
    expect(rendered[2][1]['aria-label']).toBe(TASK_CHECKBOX_LABEL);
    expect(rendered[2][1].title).toBe(TASK_CHECKBOX_LABEL);
    expect(TASK_CHECKBOX_LABEL).toContain('Enter');
  });

  test('the box is not a tab stop of its own', () => {
    // It is document content, not a control in the tab order: a
    // hundred-item checklist must not put a hundred tab stops inside one
    // document. `Mod-Enter` at the caret is the keyboard route (keymap.ts).
    const rendered = render(false) as [string, object, [string, Record<string, string>], unknown];
    expect(rendered[2][1].tabindex).toBe('-1');
  });
});
