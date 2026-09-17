import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { LAST_WORKSPACE_COOKIE } from '~/utils/workspace-cookie';
import managementFrame from './management-frame';

const { setPageLayoutMock } = vi.hoisted(() => ({ setPageLayoutMock: vi.fn() }));
mockNuxtImport('setPageLayout', () => setPageLayoutMock);

const to = { path: '/admin/registration' } as RouteLocationNormalized;

/**
 * A management screen that is not about one workspace — registration,
 * the person's profile — keeps the person's room around them when there
 * is one to keep: the workspace frame, with the management sidebar. With
 * nothing remembered it stays in the document frame, where an empty
 * sidebar would orient nobody. Decided in middleware because the layout
 * must be chosen before it renders on the server.
 */
describe('management-frame middleware', () => {
  beforeEach(() => setPageLayoutMock.mockClear());

  test('with a remembered workspace, the screen takes the workspace layout', () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent('ws-remembered:remembered')}; path=/`;

    managementFrame(to, to);

    expect(setPageLayoutMock).toHaveBeenCalledWith('workspace');
  });

  test('with nothing remembered, the screen keeps the document frame: no layout is set', () => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=; path=/; max-age=0`;

    managementFrame(to, to);

    expect(setPageLayoutMock).not.toHaveBeenCalled();
  });

  test('the two screens that use it are real routes carrying the management sidebar', async () => {
    const { useRouter } = await import('#imports');
    const routes = useRouter().getRoutes();
    for (const path of ['/admin/registration', '/account']) {
      const route = routes.find((candidate) => candidate.path === path);
      expect(route, path).toBeDefined();
      expect(route!.meta.sidebar, `${path} sidebar`).toBe('management');
      expect(route!.meta.middleware, `${path} middleware`).toContain('management-frame');
    }
  });
});
