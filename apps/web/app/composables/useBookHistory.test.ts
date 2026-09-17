import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { useBookHistory } from './useBookHistory';

/**
 * `GET /books/:id/history` (changesets spec: "Book-Level History Is One
 * Query"). Mirrors `usePageHistory`'s non-disclosure shape exactly: absence
 * and denial-of-read collapse into the SAME `not-found` status, because the
 * route itself (`apps/api/src/routes/revisions.ts`) returns a
 * byte-identical 404 for both.
 */
/**
 * Every test reads its own id: the read layer (`useApiRead`) keeps one
 * answer per key across screens — that is the cache — so two tests sharing
 * an id would share an answer. And the test app never leaves hydration on
 * its own (there is no server render to resolve), so each file says it is
 * on the client, where `load()` fetches.
 */
let ids = 0;
function nextId(prefix: string): string {
  ids += 1;
  return `${prefix}-${ids}`;
}

beforeAll(() => {
  useNuxtApp().isHydrating = false;
});

describe('useBookHistory', () => {
  // The shell holds `/w/<slug>/b/<id>` to its word from this read, not a
  // second request (`useNodeLocation`, 2026-09-17).
  test('exposes where the book lives — pending, then located by the response’s own workspace pair', async () => {
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, changesets: [] }));
    const { location, load } = useBookHistory(nextId('book'), fetcher);

    expect(location.value).toEqual({ state: 'pending' });
    await load();

    expect(location.value).toEqual({ state: 'located', workspace: { id: 'ws-1', slug: 'acme' } });
  });

  test('starts idle and moves through loading to success with the changesets as the server sent them', async () => {
    const changesets = [
      {
        id: 'cs-2',
        authorId: 'user-1',
        authorDisplayName: 'Ada',
        message: null,
        windowStart: '2026-01-02T00:00:00.000Z',
        windowEnd: '2026-01-02T00:10:00.000Z',
        revisions: [{ id: 'rev-2', pageId: 'page-1', createdAt: '2026-01-02T00:10:00.000Z' }],
      },
      {
        id: 'cs-1',
        authorId: 'user-1',
        authorDisplayName: 'Ada',
        message: 'Initial draft',
        windowStart: '2026-01-01T00:00:00.000Z',
        windowEnd: '2026-01-01T00:05:00.000Z',
        revisions: [
          { id: 'rev-1', pageId: 'page-1', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'rev-0', pageId: 'page-2', createdAt: '2026-01-01T00:05:00.000Z' },
        ],
      },
    ];
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, changesets }));
    const { status, title, workspaceId, changesets: result, load } = useBookHistory(nextId('book'), fetcher);

    expect(status.value).toBe('idle');
    expect(workspaceId.value).toBeNull();
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    // The book's own name and workspace: what the screen names itself by, and where "back to the tree" goes.
    expect(title.value).toBe('Handbook');
    expect(workspaceId.value).toBe('ws-1');
    expect(result.value).toEqual(changesets);
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/^book-\d+$/));
  });

  test('a book that exists but has no changesets yet resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, changesets: [] }));
    const { status, changesets: result, load } = useBookHistory(nextId('book'), fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual([]);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = useBookHistory(nextId('book'), fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  // A 401 is neither denial nor a dead connection: the person is signed
  // out, and the screen's next move is sign-in (`useSignInRedirect`), not
  // a retry that would 401 again. Before 2026-09-16 it fell through to
  // network-error and the screen said "Cannot reach the server".
  test('a 401 resolves to unauthenticated, not to a network error', async () => {
    const { status, load } = useBookHistory(nextId('book'), vi.fn(async () => { throw { response: { status: 401 } }; }));
    await load();
    expect(status.value).toBe('unauthenticated');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = useBookHistory(nextId('book'), fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = useBookHistory(nextId('book'), fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { title: 'Handbook', workspaceId: 'ws-1', workspace: { id: 'ws-1', slug: 'acme' }, changesets: [] };
    });
    const { status, load } = useBookHistory(nextId('book'), fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
