import { describe, expect, test } from 'bun:test';
import { Slice } from 'prosemirror-model';
import { EditorState, NodeSelection, TextSelection, type Plugin, type Transaction } from 'prosemirror-state';
import { fromMarkdown } from '../from-markdown';
import { schema } from '../schema';
import { blockAt, createBlockDragHooks, type DragView } from './block-drag';
import { buildEditorPlugins } from './plugins';

/**
 * The hooks a drag handle outside the contenteditable needs: which
 * top-level block is under the pointer (`blockAt`), and how to hand
 * ProseMirror a block drag it did not see start (`startBlockDrag`), so
 * its own drop handling and the drop cursor take over from there. The
 * DOM measurements (`posAtCoords`, `nodeDOM`) are stubbed on a fake view;
 * the DOM handle itself is the Vue batch's job.
 */

const DOC = '# Title\n\nFirst ^abc123\n\n- one\n- two\n\n***\n';

interface FakeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

function fakeView(
  state: EditorState,
  hits: Record<string, { pos: number; inside: number } | null> = {},
): DragView & { state: EditorState; rects: Map<number, FakeRect> } {
  const rects = new Map<number, FakeRect>();
  const view = {
    state,
    rects,
    dragging: null as DragView['dragging'],
    dispatch(tr: Transaction) {
      view.state = view.state.apply(tr);
    },
    posAtCoords: (coords: { left: number; top: number }) => hits[`${coords.left},${coords.top}`] ?? null,
    nodeDOM: (pos: number) => {
      const rect = rects.get(pos);
      return rect ? ({ getBoundingClientRect: () => rect } as unknown as Node) : null;
    },
  };
  return view;
}

function stateOf(markdown: string): EditorState {
  const doc = fromMarkdown(markdown);
  return EditorState.create({ schema, doc, plugins: buildEditorPlugins() as Plugin[] });
}

/** `doc` child positions: heading at 0, paragraph after it, list after that, divider last. */
function childPositions(state: EditorState): number[] {
  const positions: number[] = [];
  state.doc.forEach((_node, offset) => positions.push(offset));
  return positions;
}

describe('blockAt', () => {
  test('a pointer inside a nested list item resolves to the top-level list, with its DOM rect', () => {
    const state = stateOf(DOC);
    const [, , listPos] = childPositions(state);
    // `inside` is the innermost node the coordinates fall in: the second listItem.
    const secondItemPos = listPos! + 1 + state.doc.child(2).child(0).nodeSize;
    const view = fakeView(state, { '10,200': { pos: secondItemPos + 2, inside: secondItemPos } });
    const rect: FakeRect = { left: 0, top: 180, right: 600, bottom: 240, width: 600, height: 60 };
    view.rects.set(listPos!, rect);

    const hit = blockAt(view, { left: 10, top: 200 });

    expect(hit).not.toBeNull();
    expect(hit!.pos).toBe(listPos!);
    expect(hit!.node.type.name).toBe('list');
    expect(hit!.rect).toEqual(rect);
  });

  test('a pointer over a top-level paragraph resolves to it', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state, { '10,100': { pos: paragraphPos! + 3, inside: paragraphPos! } });
    view.rects.set(paragraphPos!, { left: 0, top: 90, right: 600, bottom: 120, width: 600, height: 30 });

    expect(blockAt(view, { left: 10, top: 100 })).toMatchObject({ pos: paragraphPos, node: state.doc.child(1) });
  });

  test('a pointer outside the editor, or in the gap between blocks, resolves to no block', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state, { '10,100': { pos: paragraphPos!, inside: -1 } });

    expect(blockAt(view, { left: 999, top: 999 })).toBeNull();
    expect(blockAt(view, { left: 10, top: 100 })).toBeNull();
  });

  test('a block whose DOM is not (yet) rendered reports a null rect rather than throwing', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state, { '10,100': { pos: paragraphPos! + 3, inside: paragraphPos! } });

    expect(blockAt(view, { left: 10, top: 100 })).toMatchObject({ pos: paragraphPos, rect: null });
  });
});

describe('startBlockDrag / endBlockDrag', () => {
  test('selects the block as a NodeSelection and hands ProseMirror the drag: its own drop handler then moves the node', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state);
    const hooks = createBlockDragHooks(view);

    expect(hooks.startBlockDrag(paragraphPos!)).toBe(true);

    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect((view.state.selection as NodeSelection).node.attrs.blockAnchor).toBe('abc123');
    expect(view.dragging).not.toBeNull();
    expect(view.dragging!.move).toBe(true);
    expect(view.dragging!.slice).toBeInstanceOf(Slice);
    // The slice is the whole block, closed on both sides — what
    // `handleDrop` recognises as a single node to re-insert intact.
    expect(view.dragging!.slice.openStart).toBe(0);
    expect(view.dragging!.slice.openEnd).toBe(0);
    expect(view.dragging!.slice.content.firstChild!.attrs.blockAnchor).toBe('abc123');
  });

  test('fills the drag transfer when given one, so browsers that need data to start a drag do', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state);
    const data: Record<string, string> = {};
    const transfer = { effectAllowed: 'none', setData: (type: string, value: string) => void (data[type] = value) };

    createBlockDragHooks(view).startBlockDrag(paragraphPos!, transfer);

    expect(data['text/plain']).toBe('First');
    expect(transfer.effectAllowed).toBe('copyMove');
  });

  test('refuses a position that is not a top-level block: false, no selection change, no drag', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state);
    const hooks = createBlockDragHooks(view);

    expect(hooks.startBlockDrag(paragraphPos! + 2)).toBe(false);
    expect(hooks.startBlockDrag(-1)).toBe(false);
    expect(hooks.startBlockDrag(state.doc.content.size + 5)).toBe(false);
    expect(view.state).toBe(state);
    expect(view.dragging).toBeNull();
  });

  test('endBlockDrag clears the drag a handle started when no drop consumed it', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state);
    const hooks = createBlockDragHooks(view);
    hooks.startBlockDrag(paragraphPos!);
    expect(view.dragging).not.toBeNull();

    hooks.endBlockDrag();

    expect(view.dragging).toBeNull();
  });

  test('a caret already inside the block is replaced by the node selection, so a drop deletes the whole block, not a caret', () => {
    const state = stateOf(DOC);
    const [, paragraphPos] = childPositions(state);
    const view = fakeView(state.apply(state.tr.setSelection(TextSelection.create(state.doc, paragraphPos! + 2))));
    createBlockDragHooks(view).startBlockDrag(paragraphPos!);
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    expect(view.state.selection.from).toBe(paragraphPos!);
  });
});
