import { describe, expect, test, vi } from 'vitest';
import type { RenamedNode } from './useTree';
import { usePageTitle } from './usePageTitle';

/**
 * The page's own title, renamed where it is read (owner decision,
 * 2026-09-23: "El title, se edita y es el mismo title del page, como en
 * obsidian"). One node, one name: this is `PATCH /nodes/:id` — the tree's
 * own rename path — asked from the page instead of from the row, so the
 * two cannot drift into two rules.
 *
 * Everything but the request is injected, so every branch is driven here
 * without a component and without a server.
 */
/** The error `$fetch` throws, in the shape `~/utils/fetch-error` reads. */
function responseError(status: number, body?: unknown) {
  return { response: { status, _data: body }, data: body };
}

function deps(overrides: Partial<Parameters<typeof usePageTitle>[0]> = {}) {
  return {
    nodeId: 'n1',
    rename: vi.fn(async (_nodeId: string, title: string) => ({ id: 'n1', slug: 'slug', title })),
    onRenamed: vi.fn(),
    ...overrides,
  };
}

describe('usePageTitle', () => {
  test('starts closed, with the stored title shown', () => {
    const title = usePageTitle(deps());

    expect(title.editing.value).toBe(false);
    expect(title.shownTitle('Handbook')).toBe('Handbook');
    expect(title.error.value).toBeNull();
  });

  test('editing opens the field on the current name', () => {
    const title = usePageTitle(deps());
    title.start('Handbook');

    expect(title.editing.value).toBe(true);
    expect(title.value.value).toBe('Handbook');
  });

  /**
   * Optimistic, the way a dropped row is where it was dropped before the
   * server has answered (`useTree`): the new name is the page's name at
   * once, the field closes, and only a refusal puts the old one back.
   */
  test('a commit shows the new name at once, patches the tree, and tells the screen', async () => {
    const d = deps();
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Team handbook';
    const pending = title.commit();

    expect(title.editing.value).toBe(false);
    expect(title.shownTitle('Handbook')).toBe('Team handbook');

    await pending;
    expect(d.rename).toHaveBeenCalledWith('n1', 'Team handbook');
    expect(d.onRenamed).toHaveBeenCalledWith({ id: 'n1', slug: 'slug', title: 'Team handbook' });
    expect(title.shownTitle('Handbook')).toBe('Team handbook');
    expect(title.error.value).toBeNull();
  });

  test('the typed name is trimmed, and a blank one writes nothing and keeps the field', async () => {
    const d = deps();
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = '   ';
    await title.commit();

    expect(d.rename).not.toHaveBeenCalled();
    expect(title.editing.value).toBe(true);
  });

  test('Enter on an unchanged name writes nothing and simply closes', async () => {
    const d = deps();
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = '  Handbook  ';
    await title.commit();

    expect(d.rename).not.toHaveBeenCalled();
    expect(title.editing.value).toBe(false);
    expect(title.shownTitle('Handbook')).toBe('Handbook');
  });

  /**
   * A duplicate sibling is fixed by typing, so the field comes back with
   * the typed text still in it and the server's own sentence beside it —
   * the tree's rule for the same refusal (`classifyWriteRefusal`), and
   * never a rename behind the person's back.
   */
  test('a 409 puts the old name back, reopens the field on the typed text, and names the conflict', async () => {
    const d = deps({
      rename: vi.fn(async () => {
        throw responseError(409, { error: 'Something here already has that name. Choose another.' });
      }),
    });
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Notes';
    await title.commit();

    expect(title.shownTitle('Handbook')).toBe('Handbook');
    expect(title.editing.value).toBe(true);
    expect(title.value.value).toBe('Notes');
    expect(title.error.value).toBe('Something here already has that name. Choose another.');
    expect(d.onRenamed).not.toHaveBeenCalled();
  });

  test('a refusal typing cannot fix puts the old name back and closes the field with the reason', async () => {
    const d = deps({
      rename: vi.fn(async () => {
        throw responseError(403, { error: 'forbidden' });
      }),
    });
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Notes';
    await title.commit();

    expect(title.shownTitle('Handbook')).toBe('Handbook');
    expect(title.editing.value).toBe(false);
    expect(title.error.value).toMatch(/permission/i);
  });

  test('typing after a refusal clears it: the message was about the name that was sent', async () => {
    const d = deps({
      rename: vi.fn(async () => {
        throw responseError(409, { error: 'Taken.' });
      }),
    });
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Notes';
    await title.commit();
    expect(title.error.value).toBe('Taken.');

    title.setValue('Notes 2');
    expect(title.error.value).toBeNull();
  });

  test('cancel closes the field and writes nothing', async () => {
    const d = deps();
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Notes';
    title.cancel();

    expect(title.editing.value).toBe(false);
    expect(title.shownTitle('Handbook')).toBe('Handbook');
    expect(d.rename).not.toHaveBeenCalled();
  });

  /**
   * A refusal that arrives after the person has started typing again
   * belongs to a name they no longer have on screen, and must not reopen
   * a field over the one they are in.
   */
  test('a refusal for a name the person has moved on from is dropped', async () => {
    let settle: (() => void) | undefined;
    const d = deps({
      rename: vi.fn(
        () =>
          new Promise<RenamedNode>((_resolve, reject) => {
            settle = () => reject(responseError(409, { error: 'Taken.' }));
          }),
      ),
    });
    const title = usePageTitle(d);
    title.start('Handbook');
    title.value.value = 'Notes';
    const pending = title.commit();
    title.start('Team handbook');
    settle!();
    await pending;

    expect(title.editing.value).toBe(true);
    expect(title.value.value).toBe('Team handbook');
    expect(title.error.value).toBeNull();
  });
});
