import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { nodeLocationOf, useNodeLocation } from './useNodeLocation';

let ids = 0;
function nextId(): string {
  ids += 1;
  return `node-location-${ids}`;
}

beforeAll(() => {
  useNuxtApp().isHydrating = false;
});

/**
 * `GET /nodes/:id/location` — which workspace a node lives in, by id and
 * by slug. The shell asks it beside the screen's own read so the address
 * `/w/<slug>/p/<id>` can be held to its word: the slug and the id must
 * name the same place, or the screen is not found.
 */
describe('useNodeLocation', () => {
  test('resolves the node’s workspace, id and slug', async () => {
    const fetcher = vi.fn(async () => ({ id: 'n', type: 'page' as const, workspaceId: 'ws-1', workspaceSlug: 'acme' }));
    const { status, location, load } = useNodeLocation(nextId(), fetcher);

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(location.value).toEqual({ id: 'n', type: 'page', workspaceId: 'ws-1', workspaceSlug: 'acme' });
  });

  test('a node the API will not locate — absent or denied, it does not say — is `not-found`; anything else is a network error', async () => {
    const notFound = Object.assign(new Error('404'), { response: { status: 404 } });
    const first = useNodeLocation(nextId(), vi.fn(async () => Promise.reject(notFound)));
    await first.load();
    expect(first.status.value).toBe('not-found');
    expect(first.location.value).toBeNull();

    const second = useNodeLocation(nextId(), vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    await second.load();
    expect(second.status.value).toBe('network-error');
  });

  test('a null node id asks nothing and stays idle', async () => {
    const fetcher = vi.fn();
    const { status, load } = useNodeLocation(null, fetcher);
    await load();
    expect(status.value).toBe('idle');
    expect(fetcher).not.toHaveBeenCalled();
  });
});

/**
 * The six node responses name their workspace by id and slug
 * (`NodeWorkspaceSchema`, 2026-09-17), so a node screen tells the shell
 * where its node lives from its own read and the shell asks nothing
 * more. What the screen says has three shapes: the read is still on its
 * way, it located the node, or it will not — refused, absent, failed —
 * and the screen answers that itself.
 */
describe('nodeLocationOf', () => {
  test('pending while the read is idle or loading, located once the response names the workspace, unknown otherwise', () => {
    expect(nodeLocationOf('idle', null)).toEqual({ state: 'pending' });
    expect(nodeLocationOf('loading', null)).toEqual({ state: 'pending' });
    expect(nodeLocationOf('success', { id: 'ws-1', slug: 'acme' })).toEqual({ state: 'located', workspace: { id: 'ws-1', slug: 'acme' } });
    expect(nodeLocationOf('not-found', null)).toEqual({ state: 'unknown' });
    expect(nodeLocationOf('forbidden', null)).toEqual({ state: 'unknown' });
    expect(nodeLocationOf('network-error', null)).toEqual({ state: 'unknown' });
  });

  test('a refused edit session that still names the workspace is located — the address is checked even when the document is not opened', () => {
    expect(nodeLocationOf('locked', { id: 'ws-1', slug: 'acme' })).toEqual({ state: 'located', workspace: { id: 'ws-1', slug: 'acme' } });
  });
});
