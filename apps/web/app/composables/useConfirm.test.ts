import { beforeEach, describe, expect, test } from 'vitest';
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

  test('two call sites read one pending question', () => {
    const a = useConfirm();
    const b = useConfirm();

    void a.confirm({ title: 'Shared?', confirmLabel: 'Yes' });

    expect(b.pending.value?.title).toBe('Shared?');
    b.settle(false);
    expect(a.pending.value).toBeNull();
  });
});
