import { describe, expect, test } from 'bun:test';
import { GapCursor } from 'prosemirror-gapcursor';
import { EditorState, NodeSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { schema } from '../schema';
import { toMarkdown } from '../to-markdown';
import { buildEditorPlugins } from './plugins';

/**
 * The plugin list `createEditorView` installs, exercised without a DOM.
 * `createEditorView` itself needs `document`; the list does not — a
 * `Plugin` is constructed eagerly and only its `view()` half touches the
 * DOM — so the keyboard contract the gap cursor adds and the drag
 * listeners the drop cursor registers are both provable here.
 */

interface FakeView {
  state: EditorState;
  dispatch: (tr: Transaction) => void;
}

function fakeView(state: EditorState): FakeView {
  const view: FakeView = {
    state,
    dispatch(tr) {
      view.state = view.state.apply(tr);
    },
  };
  return view;
}

/** Runs `event` through every plugin's `handleKeyDown` in list order, exactly as `EditorView` does, until one claims it. */
function pressKey(view: FakeView, plugins: readonly Plugin[], event: { key: string; keyCode: number }): boolean {
  const fullEvent = { ...event, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() {} };
  for (const plugin of plugins) {
    const handler = plugin.props.handleKeyDown as
      | ((view: FakeView, event: typeof fullEvent) => boolean | void)
      | undefined;
    if (handler && handler.call(plugin, view, fullEvent)) return true;
  }
  return false;
}

/** `# Title` followed by a divider — the document the perf report names as the "cannot type after a divider" dead end. */
function endsInDivider(plugins: readonly Plugin[]): EditorState {
  const doc = schema.node('doc', null, [
    schema.node('heading', { level: 1, blockAnchor: null }, schema.text('Title')),
    schema.node('thematicBreak', { blockAnchor: null }),
  ]);
  return EditorState.create({ schema, doc, plugins: plugins as Plugin[] });
}

describe('buildEditorPlugins: the gap cursor', () => {
  test('a document ending in a thematicBreak accepts a paragraph after it from the keyboard alone', () => {
    const plugins = buildEditorPlugins();
    const view = fakeView(endsInDivider(plugins));
    expect(toMarkdown(view.state.doc)).toBe('# Title\n\n***\n');

    // Select the divider (what a click or Shift+Arrow onto it does) …
    const dividerPos = view.state.doc.content.size - 1;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, dividerPos)));
    expect(view.state.selection).toBeInstanceOf(NodeSelection);

    // … press ArrowDown: without the gap cursor there is nowhere to go
    // and the key is unhandled; with it, the caret lands in the gap after
    // the divider …
    expect(pressKey(view, plugins, { key: 'ArrowDown', keyCode: 40 })).toBe(true);
    expect(view.state.selection).toBeInstanceOf(GapCursor);
    expect(view.state.selection.from).toBe(view.state.doc.content.size);

    // … and typing there creates the paragraph the document had no way to
    // grow before.
    view.dispatch(view.state.tr.insertText('After the rule'));

    expect(view.state.doc.lastChild!.type.name).toBe('paragraph');
    expect(toMarkdown(view.state.doc)).toBe('# Title\n\n***\n\nAfter the rule\n');
  });

  test('ArrowUp from a divider that opens the document reaches the gap before it', () => {
    const plugins = buildEditorPlugins();
    const doc = schema.node('doc', null, [
      schema.node('thematicBreak', { blockAnchor: null }),
      schema.node('paragraph', { blockAnchor: null }, schema.text('Body')),
    ]);
    const view = fakeView(EditorState.create({ schema, doc, plugins: plugins as Plugin[] }));
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));

    expect(pressKey(view, plugins, { key: 'ArrowUp', keyCode: 38 })).toBe(true);
    expect(view.state.selection).toBeInstanceOf(GapCursor);
    expect(view.state.selection.from).toBe(0);
  });
});

describe('buildEditorPlugins: the drop cursor', () => {
  test('one plugin listens for the four drag events on the editing surface, so a native block drag shows where it will land', () => {
    const listened: string[] = [];
    const fakeDom = {
      addEventListener: (name: string) => {
        listened.push(name);
      },
      removeEventListener: () => {},
    };
    const state = endsInDivider(buildEditorPlugins());
    const fakeEditorView = { dom: fakeDom, state, dragging: null };

    const viewSpecs = buildEditorPlugins().map((plugin) => plugin.spec.view).filter((spec) => spec !== undefined);
    const destroyers = viewSpecs.map((spec) => spec!(fakeEditorView as never));

    expect(listened.sort()).toEqual(['dragend', 'dragleave', 'dragover', 'drop']);
    for (const pluginView of destroyers) pluginView.destroy?.();
  });
});

describe('buildEditorPlugins: the task checkbox', () => {
  /** A one-item task list, with the plugin list installed exactly as `createEditorView` does. */
  function taskList(plugins: readonly Plugin[], checked: boolean | null): EditorState {
    const paragraph = schema.node('paragraph', { blockAnchor: null }, schema.text('Ship it'));
    const item = schema.node('listItem', { checked, spread: false, blockAnchor: null }, paragraph);
    const doc = schema.node('doc', null, [schema.node('list', { ordered: false }, item)]);
    return EditorState.create({ schema, doc, plugins: plugins as Plugin[] });
  }

  /** Offers the click to every plugin's `handleClickOn` in list order, exactly as `EditorView` does. */
  function clickOn(view: FakeView, plugins: readonly Plugin[], nodePos: number, target: unknown): boolean {
    const node = view.state.doc.nodeAt(nodePos)!;
    for (const plugin of plugins) {
      const handler = plugin.props.handleClickOn as
        | ((view: FakeView, pos: number, node: unknown, nodePos: number, event: unknown, direct: boolean) => boolean | void)
        | undefined;
      if (handler && handler.call(plugin, view, nodePos + 1, node, nodePos, { target }, true)) return true;
    }
    return false;
  }

  const checkbox = { nodeName: 'INPUT', getAttribute: (name: string) => (name === 'type' ? 'checkbox' : null) };

  test('a click on a task item’s checkbox ticks it, through the installed plugin list', () => {
    const plugins = buildEditorPlugins();
    const view = fakeView(taskList(plugins, false));

    expect(clickOn(view, plugins, 1, checkbox)).toBe(true);
    expect(toMarkdown(view.state.doc)).toBe('- [x] Ship it\n');
  });

  test('a click on a plain bullet item’s content reaches no handler, so the caret lands as usual', () => {
    const plugins = buildEditorPlugins();
    const view = fakeView(taskList(plugins, null));

    expect(clickOn(view, plugins, 1, checkbox)).toBe(false);
    expect(toMarkdown(view.state.doc)).toBe('- Ship it\n');
  });
});
