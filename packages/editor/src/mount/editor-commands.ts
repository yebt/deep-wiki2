/**
 * The command surface `mountEditor()` returns to its host, and the
 * per-transaction summary `onUpdate` reports. Both are DOM-free: a
 * command needs only `{ state, dispatch }` — the two members of
 * `EditorView` a ProseMirror `Command` ever touches — so
 * `editor-commands.test.ts` drives the real code path with a fake view,
 * and the DOM-bound `createEditorView` only binds it to the real one.
 *
 * Everything a toolbar button does goes through here rather than through
 * `view.dispatch` from apps/web, for one reason: the host must never
 * need to import `prosemirror-commands`/`-history` itself. The
 * `"./mount"` export is the whole editing surface; a second copy of a
 * command wired in Vue would be a second place a keystroke and a button
 * could disagree.
 */
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import type { EditorState, Transaction } from 'prosemirror-state';

/** The two members of `EditorView` a command needs; a fake view with these two runs the exact production path. */
export interface CommandTarget {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/**
 * What `onUpdate` reports after every transaction. `undoDepth`/`redoDepth`
 * are what undo/redo buttons disable from — `0` means the button does
 * nothing — read from the history plugin's own counters rather than
 * inferred from transaction counts, which cannot see grouping.
 */
export interface EditorUpdate {
  readonly transactionCount: number;
  readonly undoDepth: number;
  readonly redoDepth: number;
}

export function describeUpdate(state: EditorState, transactionCount: number): EditorUpdate {
  return { transactionCount, undoDepth: undoDepth(state), redoDepth: redoDepth(state) };
}

export interface EditorCommands {
  /** Undoes one history step. `false` when there is nothing to undo — and nothing was dispatched. */
  undo(): boolean;
  /** Redoes one history step. `false` when there is nothing to redo — and nothing was dispatched. */
  redo(): boolean;
}

export function createEditorCommands(target: CommandTarget): EditorCommands {
  const dispatch = (tr: Transaction): void => target.dispatch(tr);
  return {
    undo: () => undo(target.state, dispatch),
    redo: () => redo(target.state, dispatch),
  };
}
