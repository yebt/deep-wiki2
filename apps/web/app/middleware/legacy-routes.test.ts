import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import legacyRoutes from './legacy-routes';

const PAGE_ID = '0f3e2a9c-7b1d-4c5e-8a2f-1d2e3f4a5b6c';
const BOOK_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const WORKSPACE_ID = '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f';

const { navigateToMock, abortNavigationMock, apiMock } = vi.hoisted(() => ({
  navigateToMock: vi.fn((to: unknown, _options?: unknown) => ({ navigated: to })),
  abortNavigationMock: vi.fn((error: unknown) => ({ aborted: error })),
  apiMock: vi.fn(),
}));
mockNuxtImport('navigateTo', () => navigateToMock);
mockNuxtImport('abortNavigation', () => abortNavigationMock);
mockNuxtImport('useApiClient', () => () => apiMock);

function route(fullPath: string): RouteLocationNormalized {
  const [path] = fullPath.split('?');
  return { path, fullPath } as RouteLocationNormalized;
}

function httpError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

/**
 * Every link the product ever emitted before 2026-09-17 —
 * `/pages/<id>`, `/books/<id>/history`, `/workspaces/<id>` — still lands:
 * a bookmark, a link in a mail, a pasted address. The middleware asks the
 * API where the thing lives and moves the person there once and for
 * good (301), keeping any query the address carried. What it may not do
 * is become an oracle: a page the person cannot read, and a page that
 * never existed, bounce to exactly the same place, which is the
 * not-found screen.
 */
describe('legacy-routes middleware', () => {
  beforeEach(() => {
    navigateToMock.mockClear();
    abortNavigationMock.mockClear();
    apiMock.mockReset();
  });

  test('an address that is not a legacy one is left alone, without asking the API', async () => {
    for (const path of ['/w/acme', `/w/acme/p/${PAGE_ID}`, '/workspaces', '/workspaces/new', '/login', '/']) {
      expect(await legacyRoutes(route(path), route('/'))).toBeUndefined();
    }
    expect(apiMock).not.toHaveBeenCalled();
    expect(navigateToMock).not.toHaveBeenCalled();
  });

  test('/pages/<id> and its views move to /w/<slug>/p/<id>, permanently, with the query kept', async () => {
    apiMock.mockResolvedValue({ id: PAGE_ID, type: 'page', workspaceId: WORKSPACE_ID, workspaceSlug: 'acme' });

    await legacyRoutes(route(`/pages/${PAGE_ID}`), route('/'));
    await legacyRoutes(route(`/pages/${PAGE_ID}/edit`), route('/'));
    await legacyRoutes(route(`/pages/${PAGE_ID}/history`), route('/'));
    await legacyRoutes(route(`/pages/${PAGE_ID}/diff?from=r1&to=r2`), route('/'));

    expect(apiMock).toHaveBeenCalledWith(`/nodes/${PAGE_ID}/location`);
    expect(navigateToMock.mock.calls.map(([to, options]) => [to, options])).toEqual([
      [`/w/acme/p/${PAGE_ID}`, { redirectCode: 301, replace: true }],
      [`/w/acme/p/${PAGE_ID}/edit`, { redirectCode: 301, replace: true }],
      [`/w/acme/p/${PAGE_ID}/history`, { redirectCode: 301, replace: true }],
      [`/w/acme/p/${PAGE_ID}/diff?from=r1&to=r2`, { redirectCode: 301, replace: true }],
    ]);
  });

  test('/books/<id>/history and /diff move to /w/<slug>/b/<id>/…', async () => {
    apiMock.mockResolvedValue({ id: BOOK_ID, type: 'book', workspaceId: WORKSPACE_ID, workspaceSlug: 'acme' });

    await legacyRoutes(route(`/books/${BOOK_ID}/history`), route('/'));
    await legacyRoutes(route(`/books/${BOOK_ID}/diff?since=2026-01-01T00%3A00%3A00.000Z`), route('/'));

    expect(navigateToMock.mock.calls.map(([to]) => to)).toEqual([
      `/w/acme/b/${BOOK_ID}/history`,
      `/w/acme/b/${BOOK_ID}/diff?since=2026-01-01T00%3A00%3A00.000Z`,
    ]);
  });

  test('/workspaces/<id> and its screens move to /w/<slug>/…, resolved through the list the caller may see', async () => {
    apiMock.mockResolvedValue({ workspaces: [{ id: WORKSPACE_ID, name: 'Acme', slug: 'acme' }] });

    await legacyRoutes(route(`/workspaces/${WORKSPACE_ID}`), route('/'));
    await legacyRoutes(route(`/workspaces/${WORKSPACE_ID}/members`), route('/'));
    await legacyRoutes(route(`/workspaces/${WORKSPACE_ID}/settings`), route('/'));
    await legacyRoutes(route(`/workspaces/${WORKSPACE_ID}/ai`), route('/'));

    expect(apiMock).toHaveBeenCalledWith('/workspaces');
    expect(navigateToMock.mock.calls.map(([to]) => to)).toEqual(['/w/acme', '/w/acme/members', '/w/acme/settings', '/w/acme/ai']);
  });

  test('a workspace the caller may not see is not in their list, and lands where one that does not exist lands', async () => {
    apiMock.mockResolvedValue({ workspaces: [{ id: crypto.randomUUID(), name: 'Other', slug: 'other' }] });

    const result = await legacyRoutes(route(`/workspaces/${WORKSPACE_ID}`), route('/'));

    expect(navigateToMock).not.toHaveBeenCalled();
    expect(abortNavigationMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ aborted: expect.objectContaining({ statusCode: 404 }) });
  });

  test('a node the API will not locate — absent or denied, it does not say — is the not-found screen, byte-identical either way', async () => {
    apiMock.mockRejectedValueOnce(httpError(404)).mockRejectedValueOnce(httpError(403));

    const absent = await legacyRoutes(route(`/pages/${PAGE_ID}`), route('/'));
    const denied = await legacyRoutes(route(`/pages/${PAGE_ID}`), route('/'));

    expect(navigateToMock).not.toHaveBeenCalled();
    expect(absent).toEqual({ aborted: expect.objectContaining({ statusCode: 404 }) });
    expect(JSON.stringify(absent)).toBe(JSON.stringify(denied));
  });

  test('an id under /pages/ that names a book is not found either — the old shape said what it pointed at', async () => {
    apiMock.mockResolvedValue({ id: PAGE_ID, type: 'book', workspaceId: WORKSPACE_ID, workspaceSlug: 'acme' });

    const result = await legacyRoutes(route(`/pages/${PAGE_ID}`), route('/'));

    expect(navigateToMock).not.toHaveBeenCalled();
    expect(result).toEqual({ aborted: expect.objectContaining({ statusCode: 404 }) });
  });

  test('signed out, the person is sent to sign in and comes back to the old address, which then resolves', async () => {
    apiMock.mockRejectedValue(httpError(401));

    await legacyRoutes(route(`/pages/${PAGE_ID}/edit`), route('/'));

    expect(navigateToMock).toHaveBeenCalledWith(`/login?next=${encodeURIComponent(`/pages/${PAGE_ID}/edit`)}`, { replace: true });
  });

  test('when the API cannot be reached, the server-failed screen answers rather than a not-found', async () => {
    apiMock.mockRejectedValue(new Error('connection refused'));

    const result = await legacyRoutes(route(`/pages/${PAGE_ID}`), route('/'));

    expect(navigateToMock).not.toHaveBeenCalled();
    expect(result).toEqual({ aborted: expect.objectContaining({ statusCode: 503 }) });
  });

  test('the legacy addresses are real routes, so the middleware runs before a bare 404 could', async () => {
    const { useRouter } = await import('#imports');
    const router = useRouter();
    for (const path of [`/pages/${PAGE_ID}`, `/pages/${PAGE_ID}/edit`, `/pages/${PAGE_ID}/history`, `/pages/${PAGE_ID}/diff`, `/books/${BOOK_ID}/history`, `/books/${BOOK_ID}/diff`, `/workspaces/${WORKSPACE_ID}`, `/workspaces/${WORKSPACE_ID}/members`, `/workspaces/${WORKSPACE_ID}/settings`, `/workspaces/${WORKSPACE_ID}/ai`]) {
      const resolved = router.resolve(path);
      expect(resolved.matched.length, path).toBeGreaterThan(0);
      expect(resolved.meta.middleware, path).toEqual(['legacy-routes']);
    }
    // `/workspaces/new` is a screen of its own, not a legacy id.
    expect(router.resolve('/workspaces/new').meta.middleware).toBeUndefined();
  });
});
