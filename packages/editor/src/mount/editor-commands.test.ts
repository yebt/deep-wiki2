import { describe, expect, test } from 'bun:test';
import { EditorState, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { createEditorCommands, describeUpdate, type CommandTarget } from './editor-commands';
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
