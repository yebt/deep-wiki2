import { describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { LAST_WORKSPACE_COOKIE, useCurrentWorkspace } from './useCurrentWorkspace';

/**
 * The workspace the person is *in* — one at a time, the way a person is in
 * one Obsidian vault (apps/web/PRODUCT.md). Shared app state, not a
 * per-screen ref: a screen that learns its workspace from a response
 * (read mode) hands it here, and the next screen's sidebar starts from it
 * instead of from nothing.
 *
 * Since 2026-09-15 it is also *remembered*: Obsidian reopens the last
 * vault, and `/` sends the person to the last workspace they were in. The
 * memory is a cookie, because `/` is resolved on the server before any
 * screen renders (see `middleware/last-workspace.ts`), and a value that
 * lived only in the browser's storage could not be read there.
 */
describe('useCurrentWorkspace', () => {
  test('is shared: an id set from one call site is read from another', () => {
    const a = useCurrentWorkspace();
    const b = useCurrentWorkspace();

    a.enter('ws-1');

    expect(b.workspaceId.value).toBe('ws-1');
  });

  test('entering the same workspace again is a no-op, and a different one replaces it', () => {
    const { workspaceId, enter } = useCurrentWorkspace();
    enter('ws-1');
    enter('ws-1');
    expect(workspaceId.value).toBe('ws-1');

    enter('ws-2');
    expect(workspaceId.value).toBe('ws-2');
  });

  test('entering a workspace writes it to the cookie `/` reads', async () => {
    const { enter } = useCurrentWorkspace();

    enter('ws-remembered');
    // The cookie follows its ref on the next tick, the way every `useCookie` write does.
    await nextTick();

    expect(document.cookie).toContain(`${LAST_WORKSPACE_COOKIE}=ws-remembered`);
  });
});
