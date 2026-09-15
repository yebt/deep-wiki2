import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { describe, expect, test, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import lastWorkspace from './last-workspace';

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn((to: unknown) => to) }));
mockNuxtImport('navigateTo', () => navigateToMock);

/**
 * The other half of `last-workspace.test.ts`, in its own file because the
 * remembered workspace is read into `useState` once per app and cannot be
 * unread: with nothing remembered — a first visit, a cleared browser —
 * `/` opens onto the workspace list, where a signed-out visitor is offered
 * sign-in and a signed-in one picks a room.
 */
describe('last-workspace middleware, nothing remembered', () => {
  test('with no remembered workspace, `/` opens onto the list', () => {
    const to = { path: '/' } as RouteLocationNormalized;

    lastWorkspace(to, to);

    expect(navigateToMock).toHaveBeenCalledWith('/workspaces', { replace: true });
  });
});
