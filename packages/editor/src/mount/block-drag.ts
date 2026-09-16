/**
 * Drag-handle hooks. The handle itself lives OUTSIDE the contenteditable
 * (one absolutely-positioned element the host moves to the hovered
 * block, not N widget decorations — the Tiptap drag-handle approach,
 * which re-decorates nothing on a transaction), so ProseMirror never sees
 * its `dragstart`. These two hooks bridge that:
 *
 *   - `blockAt(coords)` — which top-level block is under the pointer and
 *     where its DOM box is, for positioning the handle;
 *   - `startBlockDrag(pos)` — select the block as a `NodeSelection` and
 *     set `view.dragging = { slice, move: true }`, which is exactly the
 *     state ProseMirror's own `dragstart` handler leaves behind. From
 *     there its `drop` handler moves the node (`handleDrop`:
 *     `tr.deleteSelection()` then re-insert) and `prosemirror-dropcursor`
 *     draws the target, so a native move drops the same node — anchor
 *     attr and all — elsewhere. Nothing here builds a transaction of its
 *     own.
 *
 * `dragend` fires on the handle, not on the editor, so a drag that ends
 * without a drop leaves `view.dragging` set; `endBlockDrag()` is the
 * handle's `dragend` hook for that.
 *
 * DOM-free except through `DragView`, the four members of `EditorView`
 * these hooks touch; `block-drag.test.ts` stubs them.
 */
import type { Node as PMNode, Slice } from 'prosemirror-model';
import { type EditorState, NodeSelection, type Transaction } from 'prosemirror-state';

/** The members of `EditorView` the drag hooks use; a fake with these runs the production path. */
export interface DragView {
  readonly state: EditorState;
  dispatch(tr: Transaction): void;
  posAtCoords(coords: { left: number; top: number }): { pos: number; inside: number } | null;
  nodeDOM(pos: number): Node | null;
  dragging: { slice: Slice; move: boolean } | null;
}

export interface BlockRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface BlockHit {
  /** Position before the block — `doc.nodeAt(pos)` is `node`, and what `startBlockDrag` takes. */
  readonly pos: number;
  readonly node: PMNode;
  /** The block's DOM box, viewport-relative; `null` when the view has not rendered it. */
  readonly rect: BlockRect | null;
}

/** The minimum of `DataTransfer` a drag needs: some data, or Firefox will not start the drag at all. */
export interface DragTransfer {
  effectAllowed: string;
  setData(type: string, data: string): void;
}

function hasRect(dom: unknown): dom is { getBoundingClientRect(): BlockRect } {
  return typeof (dom as { getBoundingClientRect?: unknown } | null)?.getBoundingClientRect === 'function';
}

/**
 * The top-level block under `coords`, or `null` outside the editor or in
 * the gap between two blocks (`inside === -1`, where there is no block to
 * show a handle for).
 */
export function blockAt(view: Pick<DragView, 'state' | 'posAtCoords' | 'nodeDOM'>, coords: { left: number; top: number }): BlockHit | null {
  const hit = view.posAtCoords(coords);
  if (!hit || hit.inside < 0) return null;
  const $inside = view.state.doc.resolve(hit.inside);
  const pos = $inside.depth === 0 ? hit.inside : $inside.before(1);
  const node = view.state.doc.nodeAt(pos);
  if (!node) return null;
  const dom = view.nodeDOM(pos);
  const rect = hasRect(dom) ? dom.getBoundingClientRect() : null;
  return { pos, node, rect: rect ? { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height } : null };
}

export interface BlockDragHooks {
  blockAt(coords: { left: number; top: number }): BlockHit | null;
  /**
   * Begins a native drag of the top-level block at `pos` (from `blockAt`).
   * `false` when `pos` is not a top-level block. Fills `transfer` with
   * the block's text and `effectAllowed = 'copyMove'` when given one —
   * the handle's `dragstart` passes `event.dataTransfer`.
   */
  startBlockDrag(pos: number, transfer?: DragTransfer): boolean;
  /** The handle's `dragend`: clears a drag no drop consumed. */
  endBlockDrag(): void;
}

export function createBlockDragHooks(view: DragView): BlockDragHooks {
  return {
    blockAt: (coords) => blockAt(view, coords),
    startBlockDrag(pos, transfer) {
      const { doc } = view.state;
      if (pos < 0 || pos > doc.content.size) return false;
      if (doc.resolve(pos).depth !== 0 || !doc.nodeAt(pos)) return false;
      const selection = NodeSelection.create(doc, pos);
      view.dispatch(view.state.tr.setSelection(selection));
      if (transfer) {
        transfer.setData('text/plain', selection.node.textContent);
        transfer.effectAllowed = 'copyMove';
      }
      view.dragging = { slice: selection.content(), move: true };
      return true;
    },
    endBlockDrag() {
      view.dragging = null;
    },
  };
}
