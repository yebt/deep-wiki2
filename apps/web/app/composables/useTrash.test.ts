import { describe, expect, test, vi } from 'vitest';
import type { ConfirmOptions, ConfirmRefusal } from './useConfirm';
import { countSentence, deleteNode, type DeleteNodeDeps, type DeleteTarget } from './useTrash';

/**
 * The delete flow behind the tree's "Delete…" (node-trash spec; design.md
 * Decision 8), as a state machine over injected pieces: the confirm
 * dialog, the two requests, and the tree's optimistic removal. What a
 * person sees is asserted in `NavigationTree.test.ts` and measured in
 * `e2e/tree-writes.spec.ts`; this file holds the order of events and
 * every refusal the server can answer with, because each is a different
 * next action (docs/UI-CHECKLIST.md §3).
 */

function responseError(status: number, data?: unknown) {
  return { response: { status }, data };
}

const PAGE: DeleteTarget = { id: 'page-1', type: 'page', title: 'Day one', visibleChildren: 0 };
const CHAPTER: DeleteTarget = { id: 'chapter-1', type: 'chapter', title: 'Onboarding', visibleChildren: 2 };
const TRASHED = { trashOperationId: 'op-1', trashed: { pages: 1, containers: 0 } };

interface Harness {
  readonly deps: DeleteNodeDeps;
  readonly asked: ConfirmOptions[];
  readonly undo: ReturnType<typeof vi.fn>;
  readonly removeRow: ReturnType<typeof vi.fn>;
}

/**
 * A stand-in for the dialog: answers each question by the script — `false`
 * cancels; `true` says yes; a string is the typed name, run through the
 * question's own `onConfirm` until it stops refusing, exactly as
 * `ConfirmDialog` keeps the dialog open on a refusal.
 */
function harness(
  answers: readonly (boolean | string)[],
  overrides: Partial<Pick<DeleteNodeDeps, 'trashFetcher' | 'forceDeleteFetcher'>> = {},
): Harness {
  const asked: ConfirmOptions[] = [];
  const undo = vi.fn();
  const removeRow = vi.fn(() => undo);
  const script = [...answers];
  const refusals: ConfirmRefusal[] = [];
  const deps: DeleteNodeDeps = {
    trashFetcher: vi.fn(async () => TRASHED),
    forceDeleteFetcher: vi.fn(async () => TRASHED),
    removeRow,
    confirm: async (options) => {
      asked.push(options);
      const answer = script.shift();
      if (answer === undefined) throw new Error('the flow asked one question too many');
      if (typeof answer === 'boolean') return answer;
      if (!options.onConfirm) throw new Error('a typed answer needs an onConfirm');
      // Type, confirm; on a refusal, confirm again (the dialog stayed open).
      let refusal = await options.onConfirm(answer);
      while (refusal) {
        refusals.push(refusal);
        const again = script.shift();
        if (again === undefined) return false;
        if (again === false) return false;
        refusal = await options.onConfirm(typeof again === 'string' ? again : answer);
      }
      return true;
    },
    ...overrides,
  };
  return { deps, asked, undo, removeRow, refusals } as Harness & { refusals: ConfirmRefusal[] };
}

describe('deleteNode — the plain delete', () => {
  test('asks first, in the product\'s words, and a "no" touches nothing', async () => {
    const h = harness([false]);

    const result = await deleteNode(PAGE, h.deps);

    expect(result).toEqual({ kind: 'cancelled' });
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toMatchObject({
      title: 'Delete “Day one”?',
      description: 'It moves to the trash for 30 days, where anyone who manages it can restore it.',
      confirmLabel: 'Delete',
      tone: 'destructive',
    });
    expect(h.asked[0]!.confirmText).toBeUndefined();
    expect(h.deps.trashFetcher).not.toHaveBeenCalled();
    expect(h.removeRow).not.toHaveBeenCalled();
  });

  test('a "yes" takes the row out before the request is answered, and a 200 keeps it out', async () => {
    let release!: () => void;
    const trashFetcher = vi.fn(() => new Promise<typeof TRASHED>((resolve) => { release = () => resolve(TRASHED); }));
    const h = harness([true], { trashFetcher });

    const pending = deleteNode(PAGE, h.deps);
    await vi.waitFor(() => expect(trashFetcher).toHaveBeenCalledWith('page-1'));
    expect(h.removeRow).toHaveBeenCalledWith('page-1');
    release();

    await expect(pending).resolves.toEqual({ kind: 'trashed', operationId: 'op-1', trashed: { pages: 1, containers: 0 } });
    expect(h.undo).not.toHaveBeenCalled();
  });

  test('a row with visible children is not taken out ahead of a request that will certainly be refused', async () => {
    const h = harness([true, false], { trashFetcher: vi.fn(async () => { throw responseError(409, { error: 'not_empty', pages: 3, containers: 0, canForce: true }); }) });

    await deleteNode(CHAPTER, h.deps);

    expect(h.removeRow).not.toHaveBeenCalled();
  });

  test.each([
    [403, "You don't have permission to delete this. Ask a workspace admin for manage access."],
    [404, 'That item is no longer there. Reload the tree and try again.'],
    [500, 'Cannot reach the server. Check your connection and try again.'],
  ])('a %s puts the row back and says why', async (status, message) => {
    const h = harness([true], { trashFetcher: vi.fn(async () => { throw responseError(status, { error: 'x' }); }) });

    const result = await deleteNode(PAGE, h.deps);

    expect(result).toEqual({ kind: 'refused', message });
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  test('no response at all is the network branch, and the row comes back', async () => {
    const h = harness([true], { trashFetcher: vi.fn(async () => { throw { response: undefined }; }) });
    const result = await deleteNode(PAGE, h.deps);
    expect(result).toEqual({ kind: 'refused', message: 'Cannot reach the server. Check your connection and try again.' });
    expect(h.undo).toHaveBeenCalledTimes(1);
  });

  test('409 not_empty without canForce puts the row back and names the counts — the server saw children the tree does not show', async () => {
    const h = harness([true], { trashFetcher: vi.fn(async () => { throw responseError(409, { error: 'not_empty', pages: 3, containers: 1, canForce: false }); }) });

    const result = await deleteNode({ ...CHAPTER, visibleChildren: 0 }, h.deps);

    expect(result).toEqual({ kind: 'refused', message: 'Empty “Onboarding” before deleting it (3 pages, 1 chapter).' });
    expect(h.undo).toHaveBeenCalledTimes(1);
    expect(h.asked).toHaveLength(1);
  });
});

describe('deleteNode — the owner\'s force-delete', () => {
  const NOT_EMPTY = { error: 'not_empty', pages: 3, containers: 1, canForce: true };

  test('409 not_empty with canForce asks again with the typed name, the counts, and the destructive tone', async () => {
    const h = harness([true, false], { trashFetcher: vi.fn(async () => { throw responseError(409, NOT_EMPTY); }) });

    const result = await deleteNode(CHAPTER, h.deps);

    expect(result).toEqual({ kind: 'cancelled' });
    expect(h.asked).toHaveLength(2);
    expect(h.asked[1]).toMatchObject({
      title: 'Delete “Onboarding” and everything in it?',
      description: '3 pages and 1 chapter will be deleted. They move to the trash for 30 days, where anyone who manages them can restore them.',
      confirmLabel: 'Delete',
      tone: 'destructive',
      confirmText: 'Onboarding',
    });
    expect(h.deps.forceDeleteFetcher).not.toHaveBeenCalled();
  });

  test('the typed name and the shown count go to force-delete; success takes the row out and reports what was trashed', async () => {
    const forced = { trashOperationId: 'op-2', trashed: { pages: 3, containers: 2 } };
    const forceDeleteFetcher = vi.fn(async () => forced);
    const h = harness([true, 'Onboarding'], { trashFetcher: vi.fn(async () => { throw responseError(409, NOT_EMPTY); }), forceDeleteFetcher });

    const result = await deleteNode(CHAPTER, h.deps);

    expect(forceDeleteFetcher).toHaveBeenCalledWith('chapter-1', { confirmName: 'Onboarding', acceptedCount: 3 });
    expect(result).toEqual({ kind: 'trashed', operationId: 'op-2', trashed: { pages: 3, containers: 2 } });
    expect(h.removeRow).toHaveBeenCalledWith('chapter-1');
    expect(h.undo).not.toHaveBeenCalled();
  });

  test('409 stale_count keeps the dialog open with the fresh count, and the next attempt submits that count', async () => {
    const forceDeleteFetcher = vi
      .fn()
      .mockRejectedValueOnce(responseError(409, { error: 'stale_count', pages: 4, containers: 1 }))
      .mockResolvedValueOnce({ trashOperationId: 'op-3', trashed: { pages: 4, containers: 2 } });
    const h = harness([true, 'Onboarding', true], { trashFetcher: vi.fn(async () => { throw responseError(409, NOT_EMPTY); }), forceDeleteFetcher }) as Harness & { refusals: ConfirmRefusal[] };

    const result = await deleteNode(CHAPTER, h.deps);

    expect(h.refusals).toEqual([
      {
        fieldError: 'The count changed while this was open. Check the new count, then confirm again.',
        description: '4 pages and 1 chapter will be deleted. They move to the trash for 30 days, where anyone who manages them can restore them.',
      },
    ]);
    expect(forceDeleteFetcher).toHaveBeenNthCalledWith(1, 'chapter-1', { confirmName: 'Onboarding', acceptedCount: 3 });
    expect(forceDeleteFetcher).toHaveBeenNthCalledWith(2, 'chapter-1', { confirmName: 'Onboarding', acceptedCount: 4 });
    expect(result).toEqual({ kind: 'trashed', operationId: 'op-3', trashed: { pages: 4, containers: 2 } });
  });

  test('409 name_mismatch keeps the dialog open with the field\'s error, and a cancel then trashes nothing', async () => {
    const forceDeleteFetcher = vi.fn(async () => { throw responseError(409, { error: 'name_mismatch' }); });
    const h = harness([true, 'Onboarding', false], { trashFetcher: vi.fn(async () => { throw responseError(409, NOT_EMPTY); }), forceDeleteFetcher }) as Harness & { refusals: ConfirmRefusal[] };

    const result = await deleteNode(CHAPTER, h.deps);

    expect(h.refusals).toEqual([{ fieldError: 'This item was renamed since the tree was loaded. Cancel, reload the tree and try again.' }]);
    expect(result).toEqual({ kind: 'cancelled' });
    expect(h.removeRow).not.toHaveBeenCalled();
  });

  test.each([
    [403, "You don't have permission to delete this. Ask a workspace admin for manage access."],
    [404, 'That item is no longer there. Reload the tree and try again.'],
    [undefined, 'Cannot reach the server. Check your connection and try again.'],
  ])('a %s on force-delete is a refusal under the field, never a closed dialog', async (status, message) => {
    const forceDeleteFetcher = vi.fn(async () => { throw status === undefined ? { response: undefined } : responseError(status, { error: 'x' }); });
    const h = harness([true, 'Onboarding', false], { trashFetcher: vi.fn(async () => { throw responseError(409, NOT_EMPTY); }), forceDeleteFetcher }) as Harness & { refusals: ConfirmRefusal[] };

    await deleteNode(CHAPTER, h.deps);

    expect(h.refusals).toEqual([{ fieldError: message }]);
  });
});

describe('countSentence', () => {
  test('names pages and containers in the product\'s words, singular and plural, dropping a zero', () => {
    expect(countSentence({ pages: 12, containers: 3 }, 'book')).toBe('12 pages and 3 chapters');
    expect(countSentence({ pages: 1, containers: 1 }, 'chapter')).toBe('1 page and 1 chapter');
    expect(countSentence({ pages: 3, containers: 0 }, 'chapter')).toBe('3 pages');
    expect(countSentence({ pages: 0, containers: 2 }, 'shelf')).toBe('2 books or chapters');
    expect(countSentence({ pages: 0, containers: 0 }, 'page')).toBe('0 pages');
    expect(countSentence({ pages: 3, containers: 1 }, 'chapter', ', ')).toBe('3 pages, 1 chapter');
  });
});
