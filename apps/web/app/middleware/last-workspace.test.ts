import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { LAST_WORKSPACE_COOKIE } from '~/composables/useCurrentWorkspace';
import lastWorkspace from './last-workspace';

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn((to: unknown) => to) }));
mockNuxtImport('navigateTo', () => navigateToMock);

const to = { path: '/' } as RouteLocationNormalized;

/**
 * `/` is the way in. A person lives in one workspace at a time
 * (apps/web/PRODUCT.md), so the front door opens onto the last workspace
 * they were in — Obsidian reopens the last vault — and onto the list only
 * when there is none to reopen. The memory is the cookie
 * `useCurrentWorkspace` writes; this middleware runs on the server, so
 * the redirect is decided before any screen renders.
 *
 * The cookie is set *before the composable's state is first read* in
 * this file: `useState` initialises from the cookie exactly once per app,
 * which is why the remembered case runs first.
 */
describe('last-workspace middleware', () => {
  beforeEach(() => navigateToMock.mockClear());

  test('with a remembered workspace, `/` opens onto its dashboard', () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=ws-remembered; path=/`;

    lastWorkspace(to, to);

    expect(navigateToMock).toHaveBeenCalledWith('/workspaces/ws-remembered', { replace: true });
  });

  test('with nothing remembered — a first visit, a cleared browser — `/` opens onto the list', () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=; path=/; max-age=0`;

    lastWorkspace(to, to);

    expect(navigateToMock).toHaveBeenCalledWith('/workspaces', { replace: true });
  });

  test('a cookie that is not a workspace id is ignored, never routed to', () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent('../admin')}; path=/`;

    lastWorkspace(to, to);

    expect(navigateToMock).toHaveBeenCalledWith('/workspaces', { replace: true });
  });

  test('the target it names is a real route, so the redirect cannot land on the not-found screen', async () => {
    const { useRouter } = await import('#imports');
    const paths = useRouter().getRoutes().map((route) => route.path);

    expect(paths).toContain('/workspaces/:workspaceId()');
    expect(paths).toContain('/workspaces');
  });
});
