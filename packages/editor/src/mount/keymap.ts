/**
 * The editor's key bindings, as data.
 *
 * Split out of `create-editor-view.ts` so a test can execute the exact
 * command a keystroke is bound to without a DOM. `createEditorView` needs
 * `document`, `Range` and `Selection`, so it is exercised only by the e2e
 * suite — which meant the bindings it installs were, until now, reachable
 * from no `bun test` at all. A test that calls `toggleMark(schema.marks.strong)`
 * directly is a *guess* that `Mod-b` is bound to that command; a test that
 * calls `EDITOR_KEY_BINDINGS['Mod-b']` cannot be wrong about it.
 */
import { baseKeymap, chainCommands, exitCode } from 'prosemirror-commands';
import { history, redo, undo } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import type { Command, Plugin } from 'prosemirror-state';
import { liftListItem, sinkListItem, splitListItem } from 'prosemirror-schema-list';
import { schema } from '../schema';
import { moveBlockDown, moveBlockUp } from './block-commands';
import { toggleMarkCommand } from './editor-commands';
import { splitDoneTaskItem, toggleTaskChecked } from './task-item';

/**
 * Every binding the editing surface installs, keyed exactly as
 * `prosemirror-keymap` receives it. `Mod-b`/`Mod-i` are the marks a user
 * reaches for most and the ones whose serialisation GATE-2's md -> doc -> md
 * corpus could never observe, because no fixture is a document the editor
 * built.
 */
export const EDITOR_KEY_BINDINGS: Readonly<Record<string, Command>> = {
  ...baseKeymap,
  // The same factory the toolbar buttons use (editor-commands.ts), so a
  // keystroke and a click never disagree on a half-marked range.
  'Mod-b': toggleMarkCommand('strong'),
  'Mod-i': toggleMarkCommand('emphasis'),
  'Mod-z': undo,
  'Shift-Mod-z': redo,
  'Mod-y': redo,
  // `splitDoneTaskItem` first: `splitListItem` copies the item's attrs, so
  // Enter at the end of `- [x] done` used to produce a second `- [x]` item —
  // a checklist ticking its own next line. It refuses on anything but a done
  // task item, so every other Enter is the plain `splitListItem` it was.
  Enter: chainCommands(splitDoneTaskItem, splitListItem(schema.nodes.listItem!), baseKeymap.Enter!),
  Tab: sinkListItem(schema.nodes.listItem!),
  'Shift-Tab': liftListItem(schema.nodes.listItem!),
  // The keyboard half of a task item's checkbox, on the binding Obsidian
  // uses for the same thing. Chained after `exitCode`, which applies only
  // inside a code block and refuses everywhere else, so the two never
  // compete: `Mod-Enter` leaves a fence where the caret is in one, and ticks
  // the box where the caret is in a task item.
  //
  // A checkbox inside a contenteditable cannot be the keyboard route on its
  // own. It is document content rather than a control in the tab order, and
  // a hundred-item checklist would otherwise put a hundred tab stops inside
  // one document. The caret is the keyboard's position in a document and
  // this is the operation performed at it — the model VS Code and Obsidian
  // both use. docs/UI-CHECKLIST.md §5 requires the keys be named in the UI
  // and not only in a comment: apps/web's block-handle menu carries a "Mark
  // done" row with this binding printed beside it.
  'Mod-Enter': chainCommands(exitCode, toggleTaskChecked),
  // The keyboard half of the block drag handle (block-commands.ts): the
  // same idiom the navigation tree already uses for reordering.
  'Alt-ArrowUp': moveBlockUp,
  'Alt-ArrowDown': moveBlockDown,
};

/** The `prosemirror-keymap` plugin `createEditorView` installs, built from `EDITOR_KEY_BINDINGS`. */
export function buildKeymap(): Plugin {
  return keymap({ ...EDITOR_KEY_BINDINGS });
}

/** The undo/redo plugin, kept beside the bindings that drive it so a test can build the same state the view does. */
export function buildHistory(): Plugin {
  return history();
}
