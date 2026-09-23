import { describe, expect, test } from 'bun:test';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection, type Transaction } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { handleTaskCheckboxClick, listItemDepth, splitDoneTaskItem, toggleTaskChecked, TASK_CHECKBOX_SELECTOR } from './task-item';

/** A state over `markdown`, with the caret at `offset` characters into the document. */
function stateOf(markdown: string, caret = 1): EditorState {
  const doc = fromMarkdown(markdown);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) });
}

/** Runs a command against a state, returning the resulting state, or `null` when the command refused. */
function run(state: EditorState, command: (s: EditorState, d?: (tr: Transaction) => void) => boolean): EditorState | null {
  let next: EditorState | null = null;
  const applied = command(state, (tr) => {
    next = state.apply(tr);
  });
  expect(applied).toBe(next !== null);
  return next;
}

/** The `checked` attribute of the first list item in a document. */
function firstItemChecked(doc: PMNode): boolean | null {
  return doc.firstChild!.firstChild!.attrs.checked;
}

describe('listItemDepth', () => {
  test('finds the enclosing list item from a caret inside its paragraph', () => {
    const state = stateOf('- [ ] a\n', 3);
    const depth = listItemDepth(state.selection.$from);

    expect(depth).not.toBeNull();
    expect(state.selection.$from.node(depth!).type).toBe(schema.nodes.listItem!);
  });

  test('finds the innermost list item in a nested list', () => {
    const state = fromMarkdown('- [ ] outer\n  - [x] inner\n');
    const doc = state;
    // The caret inside "inner": walk to the nested item's text.
    let caret = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'inner') caret = pos + 1;
    });
    expect(caret).toBeGreaterThan(0);

    const editorState = EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) });
    const depth = listItemDepth(editorState.selection.$from);
    expect(editorState.selection.$from.node(depth!).attrs.checked).toBe(true);
  });

  test('is null outside any list', () => {
    expect(listItemDepth(stateOf('Plain paragraph.\n', 3).selection.$from)).toBeNull();
  });
});

// The owner's report (2026-09-23): a task list "is not properly supported".
// In the editor the box could not be ticked at all — the schema carried a
// `checked` attribute, `/task-list` could set it to `false`, and no command,
// keystroke or click could ever set it to `true`.
describe('toggleTaskChecked', () => {
  test('an unchecked task item becomes checked', () => {
    const next = run(stateOf('- [ ] a\n', 3), toggleTaskChecked);

    expect(firstItemChecked(next!.doc)).toBe(true);
  });

  test('a checked task item becomes unchecked', () => {
    const next = run(stateOf('- [x] a\n', 3), toggleTaskChecked);

    expect(firstItemChecked(next!.doc)).toBe(false);
  });

  test('a plain bullet item is refused, and nothing is dispatched', () => {
    // `checked: null` is what distinguishes `- item` from `- [ ] item`;
    // turning a bullet into a task is `/task-list`'s job, not a toggle's.
    expect(run(stateOf('- a\n', 3), toggleTaskChecked)).toBeNull();
  });

  test('a caret outside any list is refused', () => {
    expect(run(stateOf('Plain paragraph.\n', 3), toggleTaskChecked)).toBeNull();
  });

  test('ticking round-trips to the markdown GFM spells it with', () => {
    const next = run(stateOf('- [ ] not done yet\n', 3), toggleTaskChecked);

    expect(toMarkdown(next!.doc)).toBe('- [x] not done yet\n');
  });

  test('unticking round-trips back to the byte it started from', () => {
    const ticked = run(stateOf('- [ ] not done yet\n', 3), toggleTaskChecked);
    const unticked = run(
      EditorState.create({ schema, doc: ticked!.doc, selection: TextSelection.create(ticked!.doc, 3) }),
      toggleTaskChecked,
    );

    expect(toMarkdown(unticked!.doc)).toBe('- [ ] not done yet\n');
  });

  test('only the item the caret is in is toggled', () => {
    const next = run(stateOf('- [ ] first\n- [ ] second\n', 3), toggleTaskChecked);
    const list = next!.doc.firstChild!;

    expect(list.child(0).attrs.checked).toBe(true);
    expect(list.child(1).attrs.checked).toBe(false);
    expect(toMarkdown(next!.doc)).toBe('- [x] first\n- [ ] second\n');
  });

  test('the innermost item is toggled, not its ancestor', () => {
    const doc = fromMarkdown('- [ ] outer\n  - [ ] inner\n');
    let caret = -1;
    doc.descendants((node, pos) => {
      if (node.isText && node.text === 'inner') caret = pos + 1;
    });
    const next = run(EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) }), toggleTaskChecked);

    expect(toMarkdown(next!.doc)).toBe('- [ ] outer\n  - [x] inner\n');
  });

  test('a block anchor on the item survives the toggle', () => {
    // `setNodeMarkup` replaces attrs wholesale; dropping `blockAnchor`
    // would take every comment on that block with it, which is the defect
    // `setBlockTypeKeepingAnchor` exists for one layer up.
    const state = stateOf('- [ ] a\n', 3);
    const item = state.doc.firstChild!.firstChild!;
    const withAnchor = state.apply(state.tr.setNodeMarkup(1, undefined, { ...item.attrs, blockAnchor: 'abc123' }));
    const next = run(
      EditorState.create({ schema, doc: withAnchor.doc, selection: TextSelection.create(withAnchor.doc, 3) }),
      toggleTaskChecked,
    );

    expect(next!.doc.firstChild!.firstChild!.attrs.blockAnchor).toBe('abc123');
    expect(firstItemChecked(next!.doc)).toBe(true);
  });
});

// `splitListItem` copies the item's attributes, so Enter at the end of a
// done item produced a second done item: a checklist that ticks its own
// next line. Nothing in GATE-2 could see it — no fixture is a document the
// editor built.
describe('splitDoneTaskItem', () => {
  /** A state with the caret at the end of the document's last text node. */
  function atEndOf(markdown: string): EditorState {
    const doc = fromMarkdown(markdown);
    let caret = 1;
    doc.descendants((node, pos) => {
      if (node.isText) caret = pos + node.nodeSize;
    });
    return EditorState.create({ schema, doc, selection: TextSelection.create(doc, caret) });
  }

  test('Enter after a done item starts an item that is not done', () => {
    const next = run(atEndOf('- [x] done\n'), splitDoneTaskItem);
    const typed = next!.apply(next!.tr.insertText('next'));

    expect(toMarkdown(typed.doc)).toBe('- [x] done\n- [ ] next\n');
  });

  test('a not-done item is refused, so the plain splitListItem behind it runs', () => {
    expect(run(atEndOf('- [ ] not done\n'), splitDoneTaskItem)).toBeNull();
  });

  test('a plain bullet item is refused', () => {
    expect(run(atEndOf('- a\n'), splitDoneTaskItem)).toBeNull();
  });

  test('a paragraph outside a list is refused', () => {
    expect(run(atEndOf('A paragraph.\n'), splitDoneTaskItem)).toBeNull();
  });

  test('the new item carries no copy of the original item’s block anchor', () => {
    // Two blocks with one id is the tombstone-resurrection class
    // `duplicateBlock` already strips anchors for.
    const state = atEndOf('- [x] done\n');
    const item = state.doc.firstChild!.firstChild!;
    const anchored = state.apply(state.tr.setNodeMarkup(1, undefined, { ...item.attrs, blockAnchor: 'abc123' }));
    const next = run(
      EditorState.create({ schema, doc: anchored.doc, selection: anchored.selection }),
      splitDoneTaskItem,
    );
    const list = next!.doc.firstChild!;

    expect(list.child(0).attrs.blockAnchor).toBe('abc123');
    expect(list.child(1).attrs.blockAnchor).toBeNull();
  });
});

/**
 * The mouse half. `handleClickOn` receives the position ProseMirror already
 * computed, so this needs no DOM — only the event's target, which the
 * production code inspects by tag name and `type` rather than with
 * `instanceof`, precisely so this test drives the real path.
 */
describe('handleTaskCheckboxClick', () => {
  const checkbox = { nodeName: 'INPUT', getAttribute: (name: string) => (name === 'type' ? 'checkbox' : null) };
  const paragraph = { nodeName: 'P', getAttribute: () => null };

  function clickOnFirstItem(markdown: string, target: unknown): { handled: boolean; markdown: string | null } {
    const state = stateOf(markdown, 3);
    const item = state.doc.firstChild!.firstChild!;
    let next: EditorState | null = null;
    const handled = handleTaskCheckboxClick(
      { state, dispatch: (tr) => (next = state.apply(tr)) },
      item,
      1,
      { target } as never,
    );
    return { handled, markdown: next ? toMarkdown((next as EditorState).doc) : null };
  }

  test('a click on the checkbox ticks the item', () => {
    expect(clickOnFirstItem('- [ ] a\n', checkbox)).toEqual({ handled: true, markdown: '- [x] a\n' });
  });

  test('a click on the checkbox of a ticked item unticks it', () => {
    expect(clickOnFirstItem('- [x] a\n', checkbox)).toEqual({ handled: true, markdown: '- [ ] a\n' });
  });

  test('a click on the item’s text is not a click on its checkbox', () => {
    // Otherwise every caret placement inside a task item would toggle it.
    expect(clickOnFirstItem('- [ ] a\n', paragraph)).toEqual({ handled: false, markdown: null });
  });

  test('a click on a plain bullet item is not handled', () => {
    expect(clickOnFirstItem('- a\n', checkbox)).toEqual({ handled: false, markdown: null });
  });

  test('a click on a node that is not a list item is not handled', () => {
    const state = stateOf('Plain paragraph.\n', 3);
    const handled = handleTaskCheckboxClick(
      { state, dispatch: () => expect.unreachable('a paragraph is not a task item') },
      state.doc.firstChild!,
      0,
      { target: checkbox } as never,
    );

    expect(handled).toBe(false);
  });
});

describe('TASK_CHECKBOX_SELECTOR', () => {
  test('names the element the schema actually renders', () => {
    const rendered = schema.nodes.listItem!.spec.toDOM!(
      schema.nodes.listItem!.create({ checked: false }, schema.nodes.paragraph!.create()),
    );

    expect(JSON.stringify(rendered)).toContain('"type":"checkbox"');
    expect(TASK_CHECKBOX_SELECTOR).toBe('input[type="checkbox"]');
  });
});
