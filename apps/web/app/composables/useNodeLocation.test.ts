import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { useNodeLocation } from './useNodeLocation';

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
