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
import { toggleMark } from 'prosemirror-commands';
import { redo, redoDepth, undo, undoDepth } from 'prosemirror-history';
import type { MarkType } from 'prosemirror-model';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { schema } from '../schema';
import { selectionSnapshot, type SelectionSnapshot, type ToolbarMarkName } from './selection-plugin';

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
  /** The DOM-free half of the bubble toolbar's input; the selection plugin's `onChange` adds the coordinates. */
  readonly selection: SelectionSnapshot;
}

export function describeUpdate(state: EditorState, transactionCount: number): EditorUpdate {
  return { transactionCount, undoDepth: undoDepth(state), redoDepth: redoDepth(state), selection: selectionSnapshot(state) };
}

/** The marks a toggle button flips. `link` is set/unset with a URL instead, never toggled. */
export type ToggleableMarkName = Exclude<ToolbarMarkName, 'link'>;

function markType(name: ToolbarMarkName): MarkType {
  const type = schema.marks[name];
  if (!type) throw new Error(`editor command references unknown mark "${name}"`);
  return type;
}

/**
 * The one `toggleMark` factory both the keymap (`Mod-b`, `Mod-i`) and the
 * toolbar buttons use, so a keystroke and a click can never disagree.
 * `removeWhenPresent: false` is whole-range semantics: a range half in
 * bold becomes wholly bold, and only a range wholly in bold is unbolded —
 * matching what `selectionSnapshot` reports as "active", and what the
 * button therefore showed before the click.
 */
export function toggleMarkCommand(name: ToggleableMarkName): Command {
  return toggleMark(markType(name), null, { removeWhenPresent: false });
}

/**
 * The contiguous run of inline children around `pos` carrying the same
 * `link` mark — the whole link a caret sits in — or `null` when the caret
 * is not in one. Retargeting or removing a link from a caret acts on this
 * range; zero characters would be the alternative, which is no link.
 */
function linkRangeAround(state: EditorState, pos: number): { from: number; to: number } | null {
  const type = markType('link');
  const $pos = state.doc.resolve(pos);
  const anchorMark = type.isInSet($pos.marks());
  if (!anchorMark) return null;

  const runs: Array<{ from: number; to: number }> = [];
  let cursor = $pos.start();
  $pos.parent.forEach((child) => {
    const childFrom = cursor;
    const childTo = cursor + child.nodeSize;
    cursor = childTo;
    if (!child.marks.some((mark) => mark.eq(anchorMark))) return;
    const last = runs[runs.length - 1];
    if (last && last.to === childFrom) last.to = childTo;
    else runs.push({ from: childFrom, to: childTo });
  });
  return runs.find((run) => run.from <= pos && pos <= run.to) ?? null;
}

/**
 * The range a link command acts on: the selection when it is a range,
 * else the link around the caret. `null` means "nothing to link".
 */
function linkTarget(state: EditorState): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  if (!empty) return { from, to };
  return linkRangeAround(state, from);
}

/** A textblock that allows no marks at all (this schema's `code`) rejects every mark command. */
function marksAllowedAt(state: EditorState): boolean {
  return state.selection.$from.parent.type.allowsMarkType(markType('link'));
}

export interface EditorCommands {
  /** Undoes one history step. `false` when there is nothing to undo — and nothing was dispatched. */
  undo(): boolean;
  /** Redoes one history step. `false` when there is nothing to redo — and nothing was dispatched. */
  redo(): boolean;
  /** Bold / italic / strikethrough / code over the selection (whole-range semantics, see `toggleMarkCommand`). `false` where the mark cannot apply. */
  toggleMark(name: ToggleableMarkName): boolean;
  /**
   * Links the selected range, or retargets the link a caret sits in.
   * Serialises as `[text](href)` / `[text](href "title")` — `resourceLink`
   * is pinned, so this spelling is canonical and re-opens identically.
   * `false` (nothing dispatched) at a caret outside any link, or inside a
   * code block.
   */
  setLink(href: string, title?: string | null): boolean;
  /** Removes the link over the selected range, or the whole link a caret sits in. `false` when there is none. */
  unsetLink(): boolean;
}

export function createEditorCommands(target: CommandTarget): EditorCommands {
  const dispatch = (tr: Transaction): void => target.dispatch(tr);
  return {
    undo: () => undo(target.state, dispatch),
    redo: () => redo(target.state, dispatch),
    toggleMark: (name) => toggleMarkCommand(name)(target.state, dispatch),
    setLink(href, title = null) {
      const state = target.state;
      if (!marksAllowedAt(state)) return false;
      const range = linkTarget(state);
      if (!range) return false;
      const type = markType('link');
      dispatch(state.tr.removeMark(range.from, range.to, type).addMark(range.from, range.to, type.create({ href, title })));
      return true;
    },
    unsetLink() {
      const state = target.state;
      const type = markType('link');
      const range = linkTarget(state);
      if (!range || !state.doc.rangeHasMark(range.from, range.to, type)) return false;
      dispatch(state.tr.removeMark(range.from, range.to, type));
      return true;
    },
  };
}
