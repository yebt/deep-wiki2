import { beforeEach, describe, expect, test, vi } from 'vitest';
import { useConfirm } from './useConfirm';

/**
 * The question half of the confirm dialog: a call site asks, awaits a
 * boolean, and never touches the dialog. `ConfirmDialog.vue` is the
 * answer half — it renders whatever is pending here and settles it.
 */
describe('useConfirm', () => {
  beforeEach(() => {
    // One shared pending question per app; a test must not inherit the last one's.
    useConfirm().settle(false);
  });

  test('starts with nothing pending', () => {
    expect(useConfirm().pending.value).toBeNull();
  });

  test('confirm() exposes the question with its defaults filled in, and resolves true when settled true', async () => {
    const { confirm, pending, settle } = useConfirm();

    const answer = confirm({ title: 'Leave without saving?', confirmLabel: 'Leave' });

    expect(pending.value).toMatchObject({
      title: 'Leave without saving?',
      confirmLabel: 'Leave',
      cancelLabel: 'Cancel',
      tone: 'primary',
    });
    settle(true);
    await expect(answer).resolves.toBe(true);
    expect(pending.value).toBeNull();
  });

  test('settled false resolves false', async () => {
    const { confirm, settle } = useConfirm();

    const answer = confirm({ title: 'Reload?', description: 'Unsaved edits in this tab will be lost.', confirmLabel: 'Reload', tone: 'destructive' });

    expect(useConfirm().pending.value?.tone).toBe('destructive');
    settle(false);
    await expect(answer).resolves.toBe(false);
  });

  test('a second question while one is pending answers the first with false — never two dialogs, never a promise left hanging', async () => {
    const { confirm, settle } = useConfirm();

    const first = confirm({ title: 'First?', confirmLabel: 'Yes' });
    const second = confirm({ title: 'Second?', confirmLabel: 'Yes' });

    await expect(first).resolves.toBe(false);
    expect(useConfirm().pending.value?.title).toBe('Second?');
    settle(true);
    await expect(second).resolves.toBe(true);
  });

  test('settling with nothing pending is a no-op', () => {
    expect(() => useConfirm().settle(true)).not.toThrow();
  });

  /**
   * A destructive question can ask the person to type the thing's name
   * (design.md Decision 8, `confirmText`): the match is the consent. And
   * a question whose answer the server may still refuse — the owner's
   * force-delete, re-verified against the current name and count — keeps
   * the dialog open with the refusal instead of closing on a "yes" the
   * server will not honour. `accept()` is that path: run the question's
   * `onConfirm`, close on `null`, stay open on a refusal.
   */
  describe('confirmText and accept()', () => {
    test('confirmText is null unless asked for, and carried when it is', () => {
      const { confirm, pending, settle } = useConfirm();

      void confirm({ title: 'Delete “Handbook”?', confirmLabel: 'Delete' });
      expect(pending.value?.confirmText).toBeNull();
      settle(false);

      void confirm({ title: 'Delete “Handbook”?', confirmLabel: 'Delete', confirmText: 'Handbook' });
      expect(pending.value?.confirmText).toBe('Handbook');
      settle(false);
    });

    test('accept() with no onConfirm is a plain "yes": resolves true, nothing pending, and returns no refusal', async () => {
      const { confirm, pending, accept } = useConfirm();
      const answer = confirm({ title: 'Go?', confirmLabel: 'Go' });

      await expect(accept()).resolves.toBeNull();
      await expect(answer).resolves.toBe(true);
      expect(pending.value).toBeNull();
    });

    test('accept(typed) runs onConfirm with what was typed and closes on null', async () => {
      const onConfirm = vi.fn(async () => null);
      const { confirm, pending, accept } = useConfirm();
      const answer = confirm({ title: 'Delete?', confirmLabel: 'Delete', confirmText: 'Handbook', onConfirm });

      await expect(accept('Handbook')).resolves.toBeNull();

      expect(onConfirm).toHaveBeenCalledWith('Handbook');
      await expect(answer).resolves.toBe(true);
      expect(pending.value).toBeNull();
    });

    test('a refusal from onConfirm keeps the question pending and is handed back, with any new description', async () => {
      const refusal = { fieldError: 'The count changed.', description: 'Now 4 pages will be deleted.' };
      const { confirm, pending, accept, settle } = useConfirm();
      const answer = confirm({ title: 'Delete?', confirmLabel: 'Delete', confirmText: 'Handbook', onConfirm: async () => refusal });

      await expect(accept('Handbook')).resolves.toEqual(refusal);

      expect(pending.value?.title).toBe('Delete?');
      // The person can still say no.
      settle(false);
      await expect(answer).resolves.toBe(false);
    });

    test('a question cancelled while onConfirm is still running is not answered by its late result', async () => {
      let release!: (refusal: null) => void;
      const onConfirm = vi.fn(() => new Promise<null>((resolve) => { release = resolve; }));
      const { confirm, pending, accept, settle } = useConfirm();
      const answer = confirm({ title: 'Delete?', confirmLabel: 'Delete', onConfirm });

      const attempt = accept();
      settle(false);
      await expect(answer).resolves.toBe(false);

      release(null);
      await expect(attempt).resolves.toBeNull();
      expect(pending.value).toBeNull();
    });
  });

  test('two call sites read one pending question', () => {
    const a = useConfirm();
    const b = useConfirm();

    void a.confirm({ title: 'Shared?', confirmLabel: 'Yes' });

    expect(b.pending.value?.title).toBe('Shared?');
    b.settle(false);
    expect(a.pending.value).toBeNull();
  });
});
