import { describe, expect, test } from 'bun:test';
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { createEditorCommands, describeUpdate, type CommandTarget } from './editor-commands';
import { EDITOR_KEY_BINDINGS } from './keymap';
import { buildEditorPlugins } from './plugins';

/**
 * The command surface `mountEditor()` hands the host, driven through a
 * fake view that applies each dispatched transaction exactly as
 * `EditorView`'s default `dispatchTransaction` does. No DOM: every
 * command here only ever reads `target.state` and calls
 * `target.dispatch`.
 */

interface FakeView extends CommandTarget {
  state: EditorState;
}

function fakeView(state: EditorState): FakeView {
  const view: FakeView = {
    state,
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

function paragraphState(text: string): EditorState {
  const doc = schema.node('doc', null, [schema.node('paragraph', { blockAnchor: null }, text ? schema.text(text) : undefined)]);
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, text.length + 1),
    plugins: buildEditorPlugins() as Plugin[],
  });
}

describe('describeUpdate: the undo/redo depths a toolbar disables its buttons from', () => {
  test('a fresh document has nothing to undo and nothing to redo', () => {
    expect(describeUpdate(paragraphState('Hello'), 0)).toMatchObject({ transactionCount: 0, undoDepth: 0, redoDepth: 0 });
  });

  test('one real transaction is one undoable step; undoing it is one redoable step', () => {
    const view = fakeView(paragraphState('Hello'));
    const commands = createEditorCommands(view);

    view.dispatch(view.state.tr.insertText(', world'));
    expect(toMarkdown(view.state.doc)).toBe('Hello, world\n');
    expect(describeUpdate(view.state, 1)).toMatchObject({ transactionCount: 1, undoDepth: 1, redoDepth: 0 });

    expect(commands.undo()).toBe(true);
    expect(toMarkdown(view.state.doc)).toBe('Hello\n');
    expect(describeUpdate(view.state, 2)).toMatchObject({ undoDepth: 0, redoDepth: 1 });

    expect(commands.redo()).toBe(true);
    expect(toMarkdown(view.state.doc)).toBe('Hello, world\n');
    expect(describeUpdate(view.state, 3)).toMatchObject({ undoDepth: 1, redoDepth: 0 });
  });

  test('undo() and redo() report false, and dispatch nothing, when there is nothing to do', () => {
    const view = fakeView(paragraphState('Hello'));
    const commands = createEditorCommands(view);
    let dispatched = 0;
    const counting: CommandTarget = {
      get state() {
        return view.state;
      },
      dispatch(tr) {
        dispatched += 1;
        view.dispatch(tr);
      },
    };
    const countingCommands = createEditorCommands(counting);

    expect(commands.undo()).toBe(false);
    expect(countingCommands.redo()).toBe(false);
    expect(dispatched).toBe(0);
  });
});

/** Selects the first occurrence of `text` in a single-paragraph document. */
function select(state: EditorState, text: string): EditorState {
  const paragraphStart = 1;
  const offset = state.doc.firstChild!.textContent.indexOf(text);
  if (offset < 0) throw new Error(`select: "${text}" is not in the document`);
  const from = paragraphStart + offset;
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, from + text.length)));
}

function stateOf(markdown: string): EditorState {
  const doc = fromMarkdown(markdown);
  return EditorState.create({ schema, doc, selection: TextSelection.create(doc, 1), plugins: buildEditorPlugins() as Plugin[] });
}

/** GATE-2 in the save direction: what the editor built serialises, and re-opening those bytes rebuilds the identical document. */
function expectRoundTrip(state: EditorState, markdown: string): void {
  expect(toMarkdown(state.doc)).toBe(markdown);
  expect(fromMarkdown(markdown).toJSON()).toEqual(state.doc.toJSON());
}

describe('toggleMark: the bubble toolbar buttons, with whole-range semantics', () => {
  const SPELLINGS = [
    ['strong', 'x __y__ z\n'],
    ['emphasis', 'x _y_ z\n'],
    ['delete', 'x ~~y~~ z\n'],
    ['inlineCode', 'x `y` z\n'],
  ] as const;

  for (const [name, markdown] of SPELLINGS) {
    test(`${name} on a plain word wraps it in the pinned spelling, and the result re-opens identically`, () => {
      const view = fakeView(select(stateOf('x y z'), 'y'));
      const commands = createEditorCommands(view);

      expect(commands.toggleMark(name)).toBe(true);

      expectRoundTrip(view.state, markdown);
    });
  }

  test('a range only half in bold is made wholly bold, not unbolded — what the button that read "off" promised', () => {
    // "__x y__ z": bold covers "x y"; select "y z".
    const view = fakeView(select(stateOf('__x y__ z'), 'y z'));
    const commands = createEditorCommands(view);

    expect(commands.toggleMark('strong')).toBe(true);

    expectRoundTrip(view.state, '__x y z__\n');
  });

  test('a range wholly in bold is unbolded', () => {
    const view = fakeView(select(stateOf('__x y z__'), 'x y z'));
    createEditorCommands(view).toggleMark('strong');

    expectRoundTrip(view.state, 'x y z\n');
  });

  test('Mod-b agrees with the Bold button on a half-bold range', () => {
    const state = select(stateOf('__x y__ z'), 'y z');
    let next: EditorState | undefined;
    EDITOR_KEY_BINDINGS['Mod-b']!(state, (tr) => {
      next = state.apply(tr);
    });

    expect(toMarkdown(next!.doc)).toBe('__x y z__\n');
  });

  test('inside a code block no mark applies: the command reports false and dispatches nothing', () => {
    const doc = fromMarkdown('```\nconst x = 1;\n```\n');
    const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2, 6) });
    const view = fakeView(state);
    const commands = createEditorCommands(view);

    expect(commands.toggleMark('strong')).toBe(false);
    expect(view.state).toBe(state);
  });
});

describe('setLink / unsetLink', () => {
  test('setLink on a range wraps it in a resource link — the pinned `[text](url)` spelling — that re-opens identically', () => {
    const view = fakeView(select(stateOf('read the docs now'), 'docs'));
    const commands = createEditorCommands(view);

    expect(commands.setLink('https://example.com/docs')).toBe(true);

    expectRoundTrip(view.state, 'read the [docs](https://example.com/docs) now\n');
    expect(describeUpdate(view.state, 1).selection.link).toEqual({ href: 'https://example.com/docs', title: null });
  });

  test('setLink with a title keeps the title, which the mark already models', () => {
    const view = fakeView(select(stateOf('read the docs now'), 'docs'));
    createEditorCommands(view).setLink('https://example.com/docs', 'The docs');

    expectRoundTrip(view.state, 'read the [docs](https://example.com/docs "The docs") now\n');
  });

  test('setLink at a caret inside an existing link re-targets the whole link, not zero characters', () => {
    const state = stateOf('read the [docs](https://old.test) now');
    // "read the " is 9 chars -> "docs" spans 10..14; put the caret inside it.
    const view = fakeView(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 12))));
    const commands = createEditorCommands(view);

    expect(commands.setLink('https://new.test')).toBe(true);

    expectRoundTrip(view.state, 'read the [docs](https://new.test) now\n');
  });

  test('setLink at a caret that is not in a link has nothing to link: false, nothing dispatched', () => {
    const state = stateOf('read the docs now');
    const view = fakeView(state);
    expect(createEditorCommands(view).setLink('https://example.com')).toBe(false);
    expect(view.state).toBe(state);
  });

  test('unsetLink at a caret inside a link removes the whole link; on a range, the link over that range', () => {
    const state = stateOf('read the [docs](https://old.test) now');
    const caret = fakeView(state.apply(state.tr.setSelection(TextSelection.create(state.doc, 12))));
    expect(createEditorCommands(caret).unsetLink()).toBe(true);
    expectRoundTrip(caret.state, 'read the docs now\n');

    const range = fakeView(select(state, 'docs'));
    expect(createEditorCommands(range).unsetLink()).toBe(true);
    expectRoundTrip(range.state, 'read the docs now\n');
  });

  test('unsetLink where there is no link: false, nothing dispatched', () => {
    const state = select(stateOf('read the docs now'), 'docs');
    const view = fakeView(state);
    expect(createEditorCommands(view).unsetLink()).toBe(false);
    expect(view.state).toBe(state);
  });

  test('the selection report carries the marks so a toolbar can render from onUpdate alone', () => {
    const view = fakeView(select(stateOf('__x y__ z'), 'x y'));
    const update = describeUpdate(view.state, 1);
    expect(update.selection).toMatchObject({ kind: 'text', from: 1, to: 4, empty: false, marks: { strong: true, emphasis: false } });
  });
});
