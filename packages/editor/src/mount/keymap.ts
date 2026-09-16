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
  Enter: chainCommands(splitListItem(schema.nodes.listItem!), baseKeymap.Enter!),
  Tab: sinkListItem(schema.nodes.listItem!),
  'Shift-Tab': liftListItem(schema.nodes.listItem!),
  'Mod-Enter': exitCode,
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
