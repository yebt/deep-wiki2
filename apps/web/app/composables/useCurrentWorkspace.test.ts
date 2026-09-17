import { describe, expect, test } from 'vitest';
import { nextTick } from 'vue';
import { LAST_WORKSPACE_COOKIE, rememberWorkspaceCookieValue } from '~/utils/workspace-cookie';
import * as composable from './useCurrentWorkspace';
import { rememberedWorkspace, useCurrentWorkspace } from './useCurrentWorkspace';

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
 *
 * Since 2026-09-17 a workspace is two names: the **id** the API is keyed
 * by and the **slug** every address carries (`/w/<slug>`). Both are held
 * and both are remembered, because `/` needs the slug to build the
 * address and the sidebar needs the id to fetch the tree.
 */
describe('useCurrentWorkspace', () => {
  // Nuxt auto-imports every export of a composable and of a util, and a
  // name exported by both is a collision it warns about on every
  // typecheck (`Duplicated imports "rememberWorkspaceCookieValue"`, the
  // composable's copy ignored). The cookie's name and format have one
  // owner, `utils/workspace-cookie.ts`; this module re-exports nothing.
  test('re-exports nothing of the cookie module — one owner, no auto-import collision', () => {
    expect(Object.keys(composable)).not.toContain('LAST_WORKSPACE_COOKIE');
    expect(Object.keys(composable)).not.toContain('rememberWorkspaceCookieValue');
  });

  test('is shared: a workspace entered from one call site is read from another, by id and by slug', () => {
    const a = useCurrentWorkspace();
    const b = useCurrentWorkspace();

    a.enter({ id: 'ws-1', slug: 'one' });

    expect(b.workspaceId.value).toBe('ws-1');
    expect(b.workspaceSlug.value).toBe('one');
  });

  test('entering the same workspace again is a no-op, and a different one — or a corrected slug — replaces it', () => {
    const { workspace, enter } = useCurrentWorkspace();
    enter({ id: 'ws-1', slug: 'one' });
    const first = workspace.value;
    enter({ id: 'ws-1', slug: 'one' });
    expect(workspace.value).toBe(first);

    enter({ id: 'ws-1', slug: 'one-renamed' });
    expect(workspace.value).toEqual({ id: 'ws-1', slug: 'one-renamed' });

    enter({ id: 'ws-2', slug: 'two' });
    expect(workspace.value).toEqual({ id: 'ws-2', slug: 'two' });
  });

  test('entering a workspace writes both names to the cookie `/` reads', async () => {
    const { enter } = useCurrentWorkspace();

    enter({ id: 'ws-remembered', slug: 'remembered' });
    // The cookie follows its ref on the next tick, the way every `useCookie` write does.
    await nextTick();

    expect(document.cookie).toContain(`${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(rememberWorkspaceCookieValue({ id: 'ws-remembered', slug: 'remembered' }))}`);
    expect(rememberedWorkspace()).toEqual({ id: 'ws-remembered', slug: 'remembered' });
  });

  test('a cookie that does not carry a well-formed id and slug pair remembers nothing', () => {
    for (const value of ['ws-only', '../admin:slug', 'ws-1:Not A Slug', 'ws-1:', ':slug', '']) {
      document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(value)}; path=/`;
      expect(rememberedWorkspace()).toBeNull();
    }
    document.cookie = `${LAST_WORKSPACE_COOKIE}=; path=/; max-age=0`;
  });
});
