import { beforeAll, describe, expect, test, vi } from 'vitest';
import { effectScope } from 'vue';
import { useNuxtApp } from '#imports';
import { usePageRead, type UsePageReadResult } from './usePageRead';

/**
 * Each test reads its own page id: the read layer keeps one answer per page
 * across screens (that is the cache), so two tests reading `page-1` would
 * be one page read twice. `open`/`leave` stand for a screen's mount and
 * unmount, as in useApiRead.test.ts.
 */
function open(nodeId: string, fetcher: Parameters<typeof usePageRead>[1]): { read: UsePageReadResult; leave: () => void } {
  const scope = effectScope();
  const read = scope.run(() => usePageRead(nodeId, fetcher))!;
  return { read, leave: () => scope.stop() };
}

describe('usePageRead', () => {
  beforeAll(() => {
    useNuxtApp().isHydrating = false;
  });

  test('starts idle and moves through loading to success with the cached HTML and title', async () => {
    const fetcher = vi.fn(async () => ({ html: '<p>Hello</p>', title: 'Hello', workspaceId: 'ws-1' }));
    const { status, html, title, load } = usePageRead('page-1', fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(html.value).toBe('<p>Hello</p>');
    expect(title.value).toBe('Hello');
    expect(fetcher).toHaveBeenCalledWith('page-1');
  });

  // The read screen starts the workspace-scoped presence stream from this
  // value, and nothing else on a read-only screen can supply it without a
  // side effect (the edit-session route acquires the lock).
  test('exposes the workspace id the read response carries', async () => {
    const fetcher = vi.fn(async () => ({ html: '<p>Hello</p>', title: 'Hello', workspaceId: 'ws-1' }));
    const { workspaceId, load } = usePageRead('page-2', fetcher);

    expect(workspaceId.value).toBeNull();
    await load();

    expect(workspaceId.value).toBe('ws-1');
  });

  // A 401 is neither denial nor a dead connection: the person is signed
  // out, and the screen's next move is sign-in (`useSignInRedirect`), not
  // a retry that would 401 again. Before 2026-09-16 it fell through to
  // network-error and the screen said "Cannot reach the server".
  test('a 401 resolves to unauthenticated, not to a network error', async () => {
    const { status, load } = usePageRead('page-401', vi.fn(async () => { throw { response: { status: 401 } }; }));
    await load();
    expect(status.value).toBe('unauthenticated');
  });

  test('a 403 response resolves to the permission-denied state, not a generic error', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = usePageRead('page-3', fetcher);

    await load();

    expect(status.value).toBe('forbidden');
  });

  test('a 404 response resolves to the not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = usePageRead('page-4', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageRead('page-5', fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { html: '<p>Recovered</p>', title: 'Recovered', workspaceId: 'ws-1' };
    });
    const { status, html, load } = usePageRead('page-6', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
    expect(html.value).toBe('<p>Recovered</p>');
  });

  // The data layer: coming back to a page renders it from memory. A second
  // screen for the same page has the HTML before it asks for anything, and
  // does not ask — the skeleton is for a page never seen, not for every hop.
  test('a second screen for a page already read has its content at once, without fetching', async () => {
    const first = vi.fn(async () => ({ html: '<p>Kept</p>', title: 'Kept', workspaceId: 'ws-1' }));
    const before = open('page-7', first);
    await before.read.load();
    before.leave();

    const second = vi.fn(async () => ({ html: '<p>Never</p>', title: 'Never', workspaceId: 'ws-1' }));
    const { read } = open('page-7', second);

    expect(read.status.value).toBe('success');
    expect(read.html.value).toBe('<p>Kept</p>');
    expect(read.title.value).toBe('Kept');
    expect(read.workspaceId.value).toBe('ws-1');
    expect(second).not.toHaveBeenCalled();
  });

  // Revalidation keeps the content on screen: the status stays `success`
  // and the old HTML stays in place while the fresh answer is in flight.
  test('load() on a page already on screen refreshes behind the content, never through a skeleton', async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const fetcher = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return { html: '<p>Old</p>', title: 'Old', workspaceId: 'ws-1' };
      await held;
      return { html: '<p>New</p>', title: 'New', workspaceId: 'ws-1' };
    });
    const { status, html, load } = usePageRead('page-8', fetcher);
    await load();

    const refresh = load();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(status.value).toBe('success');
    expect(html.value).toBe('<p>Old</p>');

    release();
    await refresh;
    expect(html.value).toBe('<p>New</p>');
  });

  // Absence and denial are both failures the next screen must not inherit:
  // a page that answered 404 (or 403) last time is asked again, from the
  // skeleton, exactly like one never seen. Neither is kept, so neither can
  // be told from the other by what the cache does.
  test('a cached 404 and a cached 403 are treated identically: neither is served to a later screen', async () => {
    for (const [nodeId, code] of [
      ['page-9-absent', 404],
      ['page-9-denied', 403],
    ] as const) {
      const failed = open(nodeId, async () => {
        throw { response: { status: code } };
      });
      await failed.read.load();
      failed.leave();

      const again = vi.fn(async () => ({ html: '<p>Now</p>', title: 'Now', workspaceId: 'ws-1' }));
      const { read } = open(nodeId, again);
      expect(read.status.value).toBe('idle');
      expect(read.html.value).toBe('');
      await read.load();
      expect(again).toHaveBeenCalledTimes(1);
      expect(read.status.value).toBe('success');
    }
  });
});
