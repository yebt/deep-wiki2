/**
 * GFM task items in the editing surface: finding the one the caret is in,
 * ticking it, and the click on its checkbox.
 *
 * The owner's report, 2026-09-23: "creo que no se soporta ok el task list".
 * What was actually missing was the whole *interaction*. `packages/markdown`
 * parsed `- [ ] a` and serialised it byte-identically (fixture
 * `modelled/task-list.md`, inside GATE-2), the schema carried `checked` on
 * `listItem`, and `/task-list` could set it to `false` — and nothing in the
 * product could ever set it to `true`. There was no command, no keystroke
 * and no clickable box; `schema.ts`'s `toDOM` rendered a task item as an
 * ordinary `<li>` carrying a `data-checked` attribute that no stylesheet
 * read, so a task list was also *invisible* as one. A list you cannot tick
 * is not a task list.
 *
 * Everything here is DOM-free so `task-item.test.ts` drives the exact
 * production path against a plain `EditorState`: the keyboard half is a
 * ProseMirror `Command`, and the mouse half takes the position ProseMirror
 * already computed for it rather than resolving one from a DOM node.
 */
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { splitListItem } from 'prosemirror-schema-list';
import type { Command, EditorState, Transaction } from 'prosemirror-state';
import { schema } from '../schema';

/**
 * The checkbox `schema.ts`'s `listItem.toDOM` renders, as a selector. Named
 * here rather than spelled at each use so the schema, the click handler and
 * the stylesheet cannot drift apart; `task-item.test.ts` holds it to what
 * the schema actually emits.
 */
export const TASK_CHECKBOX_SELECTOR = 'input[type="checkbox"]';

/**
 * The depth of the nearest `listItem` ancestor of `$pos`, or `null`.
 * Innermost first, so a caret in a nested item finds that item and not the
 * one containing it.
 */
export function listItemDepth($pos: ResolvedPos): number | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    if ($pos.node(depth).type === schema.nodes.listItem) return depth;
  }
  return null;
}

/**
 * Flips one list item's `checked` attribute, keeping every other attribute
 * — `spread` and, above all, `blockAnchor`, whose loss would take every
 * comment anchored to that block with it (the defect
 * `setBlockTypeKeepingAnchor` exists for one layer up in
 * `slash-plugin.ts`).
 */
function withChecked(tr: Transaction, pos: number, item: PMNode): Transaction {
  return tr.setNodeMarkup(pos, undefined, { ...item.attrs, checked: !item.attrs.checked });
}

/**
 * The keyboard half: ticks or unticks the task item the caret is in.
 *
 * Refused — dispatching nothing, so a chained command gets its turn — on a
 * plain bullet item and outside a list. `checked: null` is what
 * distinguishes `- item` from `- [ ] item` (`schema.ts`), and *making* a
 * bullet a task is `/task-list`'s job; this command only moves an existing
 * task between its two states.
 */
export const toggleTaskChecked: Command = (state: EditorState, dispatch) => {
  const { $from } = state.selection;
  const depth = listItemDepth($from);
  if (depth === null) return false;
  const item = $from.node(depth);
  if (item.attrs.checked === null) return false;
  dispatch?.(withChecked(state.tr, $from.before(depth), item));
  return true;
};

/**
 * `Enter` inside a **done** task item: splits it as `splitListItem` would,
 * and leaves the new item *not* done.
 *
 * `splitListItem` copies the original item's attributes, so pressing Enter
 * at the end of `- [x] done` produced a second `- [x]` item — a checklist
 * that ticks its own next line, which is not what any other editor does and
 * not what anyone means. Only a `checked: true` item needs the correction,
 * so this refuses everywhere else and `chainCommands` hands straight on to
 * the plain `splitListItem` (`keymap.ts`).
 *
 * The `blockAnchor` reset rides along for free and is deliberate: an anchor
 * copied into a new item would be two blocks carrying one id, the
 * tombstone-resurrection class `duplicateBlock` already strips anchors for
 * (`block-commands.ts`).
 */
export const splitDoneTaskItem: Command = (state: EditorState, dispatch) => {
  const depth = listItemDepth(state.selection.$from);
  if (depth === null) return false;
  if (state.selection.$from.node(depth).attrs.checked !== true) return false;

  return splitListItem(schema.nodes.listItem!)(
    state,
    dispatch &&
      ((tr) => {
        const newDepth = listItemDepth(tr.selection.$from);
        if (newDepth !== null) {
          const item = tr.selection.$from.node(newDepth);
          tr.setNodeMarkup(tr.selection.$from.before(newDepth), undefined, { ...item.attrs, checked: false, blockAnchor: null });
        }
        dispatch(tr);
      }),
  );
};

/** The two members of `EditorView` this file's click handler needs; a fake pair runs the production path. */
export interface TaskClickTarget {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
}

/** The part of a DOM event this file reads — a tag name and one attribute, never `instanceof`. */
interface ClickedElement {
  readonly nodeName: string;
  getAttribute(name: string): string | null;
}

function isCheckbox(target: unknown): boolean {
  const element = target as ClickedElement | null;
  if (!element || typeof element.getAttribute !== 'function') return false;
  return element.nodeName === 'INPUT' && element.getAttribute('type') === 'checkbox';
}

/**
 * The mouse half, shaped as `prosemirror-view`'s `handleClickOn` prop: for
 * each node on the clicked path ProseMirror offers the node and its
 * position, so the checkbox's document position never has to be resolved
 * from the DOM.
 *
 * The click is claimed only when the clicked element *is* the checkbox —
 * otherwise placing the caret in a task item's text would tick it, which is
 * the one way this feature could be worse than not having it. The browser
 * may flip the `<input>`'s own state before this runs; the transaction
 * below changes the node's markup, so ProseMirror re-renders the item from
 * the document and the document is what the reader ends up seeing either
 * way.
 */
export function handleTaskCheckboxClick(view: TaskClickTarget, node: PMNode, nodePos: number, event: MouseEvent): boolean {
  if (node.type !== schema.nodes.listItem) return false;
  if (node.attrs.checked === null) return false;
  if (!isCheckbox(event.target)) return false;
  view.dispatch(withChecked(view.state.tr, nodePos, node));
  return true;
}
