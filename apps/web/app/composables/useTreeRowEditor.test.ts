import { describe, expect, test, vi } from 'vitest';
import { classifyWriteRefusal, useTreeRowEditor } from './useTreeRowEditor';

/**
 * The inline row editor's state machine: **idle → naming → committing →
 * (idle | error)**.
 *
 * The owner rejected the tree's modal create and rename on 2026-09-23 and
 * asked for VS Code's input-box-in-the-row instead, so the question this
 * file holds is no longer "does the dialog submit" but "what is the row
 * doing right now" — and that is a state machine with exactly one state on
 * screen at a time. Two properties are worth a test of their own, because
 * neither is visible in a screenshot and both are what the owner's
 * criterion turns on:
 *
 * 1. **A refusal the person can fix by typing keeps the field.** A 409
 *    names the conflict beside the field with the typed text still in it —
 *    never a silent rename behind the person's back. Everything else (no
 *    permission, the parent gone, a dead connection) cannot be fixed in
 *    the field, so the draft row goes and the reason belongs beside the
 *    tree, where a refused drag already puts its own.
 * 2. **Nothing is written twice, and nothing is written for nothing.** A
 *    blank name writes nothing; a rename to the name it already has writes
 *    nothing; a second Enter while the first is in flight writes nothing.
 */

function responseError(status: number, body?: unknown) {
  return { response: { status, _data: body }, data: body };
}

const CREATE_TARGET = { parentId: 'book-1', type: 'page' as const, depth: 2, parentTitle: 'Handbook' };
const RENAME_TARGET = { id: 'page-1', type: 'page', title: 'Day one' };

describe('useTreeRowEditor', () => {
  test('starts idle: nothing is being named', () => {
    const editor = useTreeRowEditor();
    expect(editor.state.value).toBeNull();
    expect(editor.isEditing.value).toBe(false);
  });

  test('startCreate puts an empty draft into naming, at the depth the row will be drawn at', () => {
    const editor = useTreeRowEditor();
    editor.startCreate(CREATE_TARGET);

    expect(editor.isEditing.value).toBe(true);
    expect(editor.state.value).toMatchObject({
      phase: 'naming',
      value: '',
      error: null,
      draft: { mode: 'create', parentId: 'book-1', type: 'page', depth: 2, parentTitle: 'Handbook' },
    });
  });

  test('startRename opens on the current title, so the name is edited where it lives', () => {
    const editor = useTreeRowEditor();
    editor.startRename(RENAME_TARGET);

    expect(editor.state.value).toMatchObject({
      phase: 'naming',
      value: 'Day one',
      draft: { mode: 'rename', nodeId: 'page-1', originalTitle: 'Day one', type: 'page' },
    });
  });

  test('a second start replaces the first: there is one editable row, never two', () => {
    const editor = useTreeRowEditor();
    editor.startCreate(CREATE_TARGET);
    editor.startRename(RENAME_TARGET);

    expect(editor.state.value?.draft.mode).toBe('rename');
  });

  test('cancel returns to idle, and says which row was being edited so focus can go back to it', () => {
    const editor = useTreeRowEditor();
    editor.startRename(RENAME_TARGET);

    expect(editor.cancel()).toEqual({ kind: 'cancelled', draft: expect.objectContaining({ mode: 'rename', nodeId: 'page-1' }) });
    expect(editor.state.value).toBeNull();
  });

  describe('commit', () => {
    test('a create writes the trimmed name and hands back the node the server made', async () => {
      const created = { id: 'page-9', parentId: 'book-1', type: 'page' as const, slug: 'notes', title: 'Notes', position: 3 };
      const createFetcher = vi.fn(async () => created);
      const editor = useTreeRowEditor({ createFetcher });
      editor.startCreate(CREATE_TARGET);
      editor.setValue('  Notes  ');

      await expect(editor.commit()).resolves.toEqual({ kind: 'created', node: created });
      expect(createFetcher).toHaveBeenCalledWith({ parentId: 'book-1', type: 'page', title: 'Notes' });
      expect(editor.state.value, 'the draft row is replaced by the real one').toBeNull();
    });

    test('a rename writes the trimmed name and hands back what the server stored', async () => {
      const renamed = { id: 'page-1', slug: 'day-two', title: 'Day two' };
      const renameFetcher = vi.fn(async () => renamed);
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('Day two');

      await expect(editor.commit()).resolves.toEqual({ kind: 'renamed', node: renamed });
      expect(renameFetcher).toHaveBeenCalledWith('page-1', { title: 'Day two' });
      expect(editor.state.value).toBeNull();
    });

    test('the phase is committing while the request is in flight, and the typed name stays on screen', async () => {
      let release!: (value: { id: string; slug: string; title: string }) => void;
      const renameFetcher = vi.fn(() => new Promise<{ id: string; slug: string; title: string }>((resolve) => { release = resolve; }));
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('Day two');

      const settled = editor.commit();
      expect(editor.state.value).toMatchObject({ phase: 'committing', value: 'Day two' });

      release({ id: 'page-1', slug: 'day-two', title: 'Day two' });
      await settled;
      expect(editor.state.value).toBeNull();
    });

    test('a blank name writes nothing and keeps the field open', async () => {
      const createFetcher = vi.fn();
      const editor = useTreeRowEditor({ createFetcher });
      editor.startCreate(CREATE_TARGET);
      editor.setValue('   ');

      await expect(editor.commit()).resolves.toEqual({ kind: 'ignored' });
      expect(createFetcher).not.toHaveBeenCalled();
      expect(editor.state.value?.phase).toBe('naming');
    });

    test('a rename to the name it already has writes nothing, and simply closes', async () => {
      const renameFetcher = vi.fn();
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('  Day one  ');

      await expect(editor.commit()).resolves.toEqual({ kind: 'unchanged', nodeId: 'page-1' });
      expect(renameFetcher).not.toHaveBeenCalled();
      expect(editor.state.value).toBeNull();
    });

    test('a second Enter while the first is in flight writes nothing twice', async () => {
      let release!: (value: { id: string; slug: string; title: string }) => void;
      const renameFetcher = vi.fn(() => new Promise<{ id: string; slug: string; title: string }>((resolve) => { release = resolve; }));
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('Day two');

      const first = editor.commit();
      await expect(editor.commit()).resolves.toEqual({ kind: 'ignored' });
      expect(renameFetcher).toHaveBeenCalledTimes(1);

      release({ id: 'page-1', slug: 'day-two', title: 'Day two' });
      await first;
    });

    test('Escape while the request is in flight is ignored: a cancel cannot outrun a write', () => {
      const renameFetcher = vi.fn(() => new Promise<never>(() => {}));
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('Day two');
      void editor.commit();

      expect(editor.cancel()).toEqual({ kind: 'ignored' });
      expect(editor.state.value?.phase).toBe('committing');
    });

    test('a duplicate name keeps the field, with the server’s own words beside it', async () => {
      const renameFetcher = vi.fn(async () => {
        throw responseError(409, { error: 'A page called “Day two” is already here.' });
      });
      const editor = useTreeRowEditor({ renameFetcher });
      editor.startRename(RENAME_TARGET);
      editor.setValue('Day two');

      await expect(editor.commit()).resolves.toEqual({ kind: 'kept' });
      expect(editor.state.value).toMatchObject({
        phase: 'error',
        value: 'Day two',
        error: 'A page called “Day two” is already here.',
      });
    });

    test('typing after a refusal clears the error and goes back to naming — the message was about the name that was sent', async () => {
      const createFetcher = vi.fn(async () => {
        throw responseError(409);
      });
      const editor = useTreeRowEditor({ createFetcher });
      editor.startCreate(CREATE_TARGET);
      editor.setValue('Notes');
      await editor.commit();
      expect(editor.state.value?.phase).toBe('error');

      editor.setValue('Notes 2');
      expect(editor.state.value).toMatchObject({ phase: 'naming', value: 'Notes 2', error: null });
    });

    test('a refusal the field cannot fix takes the draft away and hands the reason to the tree', async () => {
      const createFetcher = vi.fn(async () => {
        throw responseError(403);
      });
      const editor = useTreeRowEditor({ createFetcher });
      editor.startCreate(CREATE_TARGET);
      editor.setValue('Notes');

      const outcome = await editor.commit();
      expect(outcome.kind).toBe('abandoned');
      expect(outcome).toMatchObject({ message: expect.stringContaining('permission') });
      expect(editor.state.value, 'the draft row is gone').toBeNull();
    });
  });
});

describe('classifyWriteRefusal', () => {
  test('only a name collision is the field’s to fix', () => {
    expect(classifyWriteRefusal(responseError(409), 'create').keepsField).toBe(true);
    for (const status of [400, 403, 404, 500]) {
      expect(classifyWriteRefusal(responseError(status), 'create').keepsField, String(status)).toBe(false);
    }
  });

  test('the server’s own sentence is preferred over ours, for the two statuses that carry one', () => {
    expect(classifyWriteRefusal(responseError(409, { error: 'Taken.' }), 'create').message).toBe('Taken.');
    expect(classifyWriteRefusal(responseError(400, { error: 'A page cannot hold a page.' }), 'create').message).toBe('A page cannot hold a page.');
  });

  test('403 says which write was refused, because the next action differs', () => {
    expect(classifyWriteRefusal(responseError(403), 'create').message).toMatch(/create/i);
    expect(classifyWriteRefusal(responseError(403), 'rename').message).toMatch(/rename/i);
  });

  test('a dead connection is never reported as a permission problem', () => {
    expect(classifyWriteRefusal(new Error('fetch failed'), 'create').message).toMatch(/Cannot reach the server/);
  });
});
