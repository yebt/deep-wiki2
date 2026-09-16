import { describe, expect, test, vi } from 'vitest';
import { blockTunesMenu, caretBlock, currentTurnIntoTarget, placeCaretIn, TURN_INTO_TARGET_IDS, type TunesActions, type TunesInput } from './block-tunes';

/**
 * The block handle's tunes menu, decided without a DOM or a document:
 * `EditorSurface` dry-runs the handle's commands and hands the answers
 * here, and this decides what the menu offers, what it withholds and
 * why — so every disabled item carries its reason (docs/UI-CHECKLIST.md
 * §3, §5) and the decision is testable without ProseMirror.
 */
const ACTIONS: TunesActions = {
  moveUp: vi.fn(),
  moveDown: vi.fn(),
  duplicate: vi.fn(),
  remove: vi.fn(),
  turnInto: vi.fn(),
};

const TARGETS = [
  { id: 'text', label: 'Text', applicable: true },
  { id: 'heading-1', label: 'Heading 1', applicable: true },
  { id: 'heading-2', label: 'Heading 2', applicable: false },
  { id: 'bullet-list', label: 'Bulleted list', applicable: true },
];

const INPUT: TunesInput = {
  blockType: 'heading',
  canMoveUp: true,
  canMoveDown: true,
  canDuplicate: true,
  canDelete: true,
  turnInto: TARGETS,
  currentTargetId: 'heading-2',
};

function flat(input: TunesInput) {
  return blockTunesMenu(input, ACTIONS).flat();
}

function item(input: TunesInput, label: string) {
  const found = flat(input).find((entry) => entry.label === label);
  if (!found) throw new Error(`no item "${label}"`);
  return found;
}

describe('blockTunesMenu', () => {
  test('offers Turn into first, then the moves, Duplicate and Delete, each with an icon beside its label (§4.3)', () => {
    const labels = flat(INPUT).map((entry) => entry.label);

    expect(labels).toEqual(['Turn into', 'Move up', 'Move down', 'Duplicate', 'Delete']);
    for (const entry of flat(INPUT)) expect(entry.icon).toMatch(/^i-lucide-/);
  });

  test('a move that cannot apply stays in the menu, disabled, with the reason as its description', () => {
    const first = { ...INPUT, canMoveUp: false };
    const last = { ...INPUT, canMoveDown: false };

    expect(item(first, 'Move up').disabled).toBe(true);
    expect(item(first, 'Move up').description).toMatch(/already the first block/i);
    expect(item(first, 'Move down').disabled).toBeFalsy();
    expect(item(last, 'Move down').description).toMatch(/already the last block/i);
  });

  test('the moves say their keys, the keyboard twin of the drag (§5)', () => {
    expect(item(INPUT, 'Move up').kbds).toEqual(['alt', 'arrowup']);
    expect(item(INPUT, 'Move down').kbds).toEqual(['alt', 'arrowdown']);
  });

  test('selecting an item runs its action, and a disabled item runs nothing', () => {
    vi.mocked(ACTIONS.moveUp).mockClear();
    vi.mocked(ACTIONS.remove).mockClear();

    item(INPUT, 'Move up').onSelect?.();
    item(INPUT, 'Delete').onSelect?.();
    item({ ...INPUT, canMoveUp: false }, 'Move up').onSelect?.();

    expect(ACTIONS.moveUp).toHaveBeenCalledTimes(1);
    expect(ACTIONS.remove).toHaveBeenCalledTimes(1);
  });

  test('Turn into lists the targets as a submenu, Text first, the current kind disabled as "already", the others that cannot apply disabled with a reason', () => {
    const turnInto = item(INPUT, 'Turn into');

    expect(turnInto.children?.map((child) => child.label)).toEqual(['Text', 'Heading 1', 'Heading 2', 'Bulleted list']);
    const current = turnInto.children!.find((child) => child.label === 'Heading 2')!;
    expect(current.disabled).toBe(true);
    expect(current.description).toMatch(/already a heading 2/i);
    expect(turnInto.children!.find((child) => child.label === 'Heading 1')!.disabled).toBeFalsy();
    const cannot = flat({ ...INPUT, turnInto: [{ id: 'quote', label: 'Quote', applicable: false }], currentTargetId: null });
    const quote = cannot.find((entry) => entry.label === 'Turn into')!.children![0]!;
    expect(quote.disabled).toBe(true);
    expect(quote.description).toMatch(/not available/i);
  });

  test('selecting a target runs turnInto with its id', () => {
    vi.mocked(ACTIONS.turnInto).mockClear();

    item(INPUT, 'Turn into').children!.find((child) => child.label === 'Heading 1')!.onSelect?.();

    expect(ACTIONS.turnInto).toHaveBeenCalledWith('heading-1');
  });

  test('a table, a footnote definition and a verbatim block get no submenu: Turn into itself is disabled, naming the block', () => {
    for (const [blockType, reason] of [
      ['table', /table/i],
      ['footnoteDefinition', /footnote/i],
      ['verbatim', /raw/i],
    ] as const) {
      const turnInto = item({ ...INPUT, blockType, turnInto: [] }, 'Turn into');
      expect(turnInto.disabled).toBe(true);
      expect(turnInto.children).toBeUndefined();
      expect(turnInto.description).toMatch(reason);
    }
  });
});

describe('TURN_INTO_TARGET_IDS', () => {
  test('are the block transforms, Text first, and never an insertion (divider, table, footnote add a block rather than retype this one)', () => {
    expect(TURN_INTO_TARGET_IDS[0]).toBe('text');
    expect(TURN_INTO_TARGET_IDS).not.toContain('divider');
    expect(TURN_INTO_TARGET_IDS).not.toContain('table');
    expect(TURN_INTO_TARGET_IDS).not.toContain('footnote');
    expect(TURN_INTO_TARGET_IDS).toEqual(expect.arrayContaining(['heading-1', 'heading-2', 'heading-3', 'bullet-list', 'numbered-list', 'task-list', 'quote', 'code-block']));
  });
});

describe('currentTurnIntoTarget', () => {
  test('names the target a block already is, from its type and attrs', () => {
    expect(currentTurnIntoTarget({ type: { name: 'paragraph' }, attrs: {}, firstChild: null })).toBe('text');
    expect(currentTurnIntoTarget({ type: { name: 'heading' }, attrs: { level: 3 }, firstChild: null })).toBe('heading-3');
    expect(currentTurnIntoTarget({ type: { name: 'blockquote' }, attrs: {}, firstChild: null })).toBe('quote');
    expect(currentTurnIntoTarget({ type: { name: 'code' }, attrs: {}, firstChild: null })).toBe('code-block');
    expect(currentTurnIntoTarget({ type: { name: 'list' }, attrs: { ordered: true }, firstChild: { attrs: { checked: null } } })).toBe('numbered-list');
    expect(currentTurnIntoTarget({ type: { name: 'list' }, attrs: { ordered: false }, firstChild: { attrs: { checked: false } } })).toBe('task-list');
    expect(currentTurnIntoTarget({ type: { name: 'list' }, attrs: { ordered: false }, firstChild: { attrs: { checked: null } } })).toBe('bullet-list');
    expect(currentTurnIntoTarget({ type: { name: 'table' }, attrs: {}, firstChild: null })).toBeNull();
  });
});

/**
 * The two selection helpers work on the view through the members they
 * touch — `state.doc`, `state.selection`, `state.tr`, `dispatch` — so a
 * fake with those runs the exact production path.
 */
describe('caretBlock', () => {
  test('is the top-level block the selection is in: the depth-1 ancestor of a caret, the node itself when it is selected whole', () => {
    const block = { type: { name: 'paragraph' } };
    const doc = {
      resolve: (pos: number) => (pos === 7 ? { depth: 2, before: (depth: number) => (depth === 1 ? 4 : -1) } : { depth: 0 }),
      nodeAt: (pos: number) => (pos === 4 ? block : null),
    };

    expect(caretBlock({ doc, selection: { from: 7 } })).toEqual({ pos: 4, node: block });
    expect(caretBlock({ doc, selection: { from: 4 } })).toEqual({ pos: 4, node: block });
  });

  test('is null for a gap cursor, which sits between blocks and belongs to none', () => {
    const doc = { resolve: () => ({ depth: 0 }), nodeAt: () => null };

    expect(caretBlock({ doc, selection: { from: 9 } })).toBeNull();
  });
});

describe('placeCaretIn', () => {
  /**
   * `EditorHandle` exposes no way to put the caret into a block (recorded
   * in docs/TODO.md), so the `Selection` class is reached through the
   * state's own selection instance — every state's selection is a
   * `Selection` subclass, and `near` is a static every subclass inherits.
   */
  test('dispatches the selection nearest inside the block at pos, found through the state\'s own selection class', () => {
    const near = vi.fn((resolved: { pos: number }) => ({ kind: 'near', at: resolved.pos }));
    class FakeSelection {
      static near = near;
      readonly from = 0;
    }
    const setSelection = vi.fn((selection: unknown) => ({ selection }));
    const dispatch = vi.fn();
    const view = {
      state: {
        doc: { content: { size: 20 }, resolve: (pos: number) => ({ pos }) },
        selection: new FakeSelection(),
        get tr() {
          return { setSelection };
        },
      },
      dispatch,
    };

    expect(placeCaretIn(view, 5)).toBe(true);

    expect(near).toHaveBeenCalledWith({ pos: 5 }, 1);
    expect(dispatch).toHaveBeenCalledWith({ selection: { kind: 'near', at: 5 } });
  });

  test('refuses a position outside the document and dispatches nothing', () => {
    const dispatch = vi.fn();
    const view = {
      state: { doc: { content: { size: 20 }, resolve: (pos: number) => ({ pos }) }, selection: {}, get tr() { return { setSelection: () => ({}) }; } },
      dispatch,
    };

    expect(placeCaretIn(view, -1)).toBe(false);
    expect(placeCaretIn(view, 20)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
