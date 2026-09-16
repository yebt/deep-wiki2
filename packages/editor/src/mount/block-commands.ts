/**
 * The block "tunes" — move up/down, delete, duplicate, turn into — as
 * pure ProseMirror `Command`s over the TOP-LEVEL block the selection is
 * in. DOM-free: `block-commands.test.ts` applies each one, serialises the
 * result with `toMarkdown`, re-parses it and asserts the identical
 * document, so no tune can produce a construct the pinned pipeline
 * cannot spell.
 *
 * "Top-level" is deliberate. A caret in a nested list item tunes the whole
 * list, and a caret in a quoted paragraph tunes the whole quote: the
 * handle a block-drag UI shows sits beside a document child, and the
 * keyboard equivalent (`Alt-ArrowUp/Down`, keymap.ts) must move the same
 * thing the handle would. Moving inside a list is Tab/Shift-Tab's job.
 *
 * GATE-2 per tune, as the perf report reasons it: a move only rearranges
 * existing nodes and every block re-serialises through the same pinned
 * handler, so it cannot change spelling. A duplicate would — an anchor
 * copied verbatim is two blocks with one id, which the save path's block
 * matcher would resolve by tombstoning one and the other would then be
 * the "resurrected dead id" `DeadAnchorError` exists to refuse — so the
 * copy is stripped of every `blockAnchor`, at every depth.
 */
import type { Node as PMNode } from 'prosemirror-model';
import { type Command, type EditorState, NodeSelection, Selection, TextSelection, type Transaction } from 'prosemirror-state';
import { SLASH_COMMANDS } from './slash-plugin';

export interface TopLevelBlock {
  /** Position before the block — `state.doc.nodeAt(pos)` is `node`. */
  readonly pos: number;
  readonly node: PMNode;
  /** Index among `doc`'s children. */
  readonly index: number;
}

/**
 * The document child the selection is in: the node itself for a node
 * selection of a top-level block, the depth-1 ancestor for anything
 * inside one, and `null` for a gap cursor, which sits BETWEEN blocks and
 * belongs to none.
 */
export function topLevelBlock(state: EditorState): TopLevelBlock | null {
  const { selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0) {
    return { pos: selection.from, node: selection.node, index: selection.$from.index(0) };
  }
  const { $from } = selection;
  if ($from.depth === 0) return null;
  return { pos: $from.before(1), node: $from.node(1), index: $from.index(0) };
}

/** Re-creates `selection` (taken before the edit) at the same offset inside a block that now starts at `newPos` (it started at `oldPos`). */
function selectionInsideMovedBlock(tr: Transaction, selection: Selection, oldPos: number, newPos: number): Selection {
  const shift = newPos - oldPos;
  if (selection instanceof NodeSelection) return NodeSelection.create(tr.doc, newPos);
  return TextSelection.between(tr.doc.resolve(selection.anchor + shift), tr.doc.resolve(selection.head + shift));
}

function moveBlock(direction: -1 | 1): Command {
  return (state, dispatch) => {
    const block = topLevelBlock(state);
    if (!block) return false;
    const { doc } = state;
    const siblingIndex = block.index + direction;
    if (siblingIndex < 0 || siblingIndex >= doc.childCount) return false;
    const sibling = doc.child(siblingIndex);

    // Both moves are one delete plus one insert of the SAME node, so the
    // anchor attr — and every other attr — travels with it untouched.
    const from = block.pos;
    const to = block.pos + block.node.nodeSize;
    const newPos = direction === -1 ? from - sibling.nodeSize : from + sibling.nodeSize;
    if (dispatch) {
      const tr = state.tr.delete(from, to).insert(newPos, block.node);
      // `tr.selection` was mapped through the delete; rebuild it from the
      // original offsets instead, so a caret inside the moved block does
      // not end up wherever the deletion left it.
      tr.setSelection(selectionInsideMovedBlock(tr, state.selection, from, newPos));
      dispatch(tr.scrollIntoView());
    }
    return true;
  };
}

/** Moves the top-level block one sibling up. `false` at the first block. */
export const moveBlockUp: Command = moveBlock(-1);
/** Moves the top-level block one sibling down. `false` at the last block. */
export const moveBlockDown: Command = moveBlock(1);

/** Removes the top-level block. Deleting the only block leaves the one empty paragraph an empty document is (from-markdown.ts). */
export const deleteBlock: Command = (state, dispatch) => {
  const block = topLevelBlock(state);
  if (!block) return false;
  if (dispatch) {
    const tr = state.tr.delete(block.pos, block.pos + block.node.nodeSize);
    tr.setSelection(Selection.near(tr.doc.resolve(Math.min(block.pos, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/** A deep copy of `node` with every `blockAnchor` attr, at every depth, reset to `null`. */
export function withoutAnchors(node: PMNode): PMNode {
  const children: PMNode[] = [];
  node.forEach((child) => children.push(withoutAnchors(child)));
  const attrs = 'blockAnchor' in node.attrs ? { ...node.attrs, blockAnchor: null } : node.attrs;
  if (node.isText) return node;
  return node.type.create(attrs, children, node.marks);
}

/** Inserts an anchor-free copy of the top-level block directly after it and moves the selection into the copy. */
export const duplicateBlock: Command = (state, dispatch) => {
  const block = topLevelBlock(state);
  if (!block) return false;
  if (dispatch) {
    const after = block.pos + block.node.nodeSize;
    const tr = state.tr.insert(after, withoutAnchors(block.node));
    tr.setSelection(selectionInsideMovedBlock(tr, state.selection, block.pos, after));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

/**
 * Blocks "turn into" refuses: a table is cell structure no textblock
 * command can retype, a footnote definition is addressed by its
 * identifier from elsewhere in the document, and a verbatim block is raw
 * source carried byte-for-byte (schema.ts, bucket B).
 */
export const BLOCK_COMMANDS_NOT_TURNABLE: readonly string[] = ['table', 'footnoteDefinition', 'verbatim'];

/**
 * Runs the slash command with this id (`SLASH_COMMANDS`) at the current
 * selection — the exact transform typing `/` + Enter there would apply,
 * so the tunes menu and the slash menu can never turn the same block into
 * two different things. `false` for an unknown id, or on a block in
 * `BLOCK_COMMANDS_NOT_TURNABLE`.
 */
export function turnInto(commandId: string): Command {
  return (state, dispatch) => {
    const command = SLASH_COMMANDS.find((candidate) => candidate.id === commandId);
    if (!command) return false;
    const block = topLevelBlock(state);
    if (!block || BLOCK_COMMANDS_NOT_TURNABLE.includes(block.node.type.name)) return false;
    return command.run(state, dispatch);
  };
}
