import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { usePageHistory } from './usePageHistory';

/**
 * `GET /pages/:id/history` (revision-history spec: "Page History Query
 * Returns Revisions Newest First"). Absence and denial-of-read collapse
 * into the SAME `not-found` state — never a distinct `forbidden` status
 * like `usePageRead`'s — because the route itself returns byte-identical
 * 404s for both (`apps/api/src/routes/revisions.ts`), and a composable
 * that split them back apart on the client would defeat the
 * non-disclosure the server already went to the trouble of providing.
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

describe('usePageHistory', () => {
  test('starts idle and moves through loading to success with the revisions, newest first as the server sent them', async () => {
    const revisions = [
      { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Ada', createdAt: '2026-01-02T00:00:00.000Z', changesetId: null, contentHash: 'hash-2' },
      { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Ada', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null, contentHash: 'hash-1' },
    ];
    const fetcher = vi.fn(async () => ({ revisions }));
    const { status, revisions: result, load } = usePageHistory(nextId('page'), fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(result.value).toEqual(revisions);
    expect(fetcher).toHaveBeenCalledWith(expect.stringMatching(/^page-\d+$/));
  });

  test('a page that exists but has never been saved resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ revisions: [] }));
    const { status, revisions: result, load } = usePageHistory(nextId('page'), fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual([]);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = usePageHistory(nextId('page'), fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  // A 401 is neither denial nor a dead connection: the person is signed
  // out, and the screen's next move is sign-in (`useSignInRedirect`), not
  // a retry that would 401 again. Before 2026-09-16 it fell through to
  // network-error and the screen said "Cannot reach the server".
  test('a 401 resolves to unauthenticated, not to a network error', async () => {
    const { status, load } = usePageHistory(nextId('page'), vi.fn(async () => { throw { response: { status: 401 } }; }));
    await load();
    expect(status.value).toBe('unauthenticated');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = usePageHistory(nextId('page'), fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageHistory(nextId('page'), fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { revisions: [] };
    });
    const { status, load } = usePageHistory(nextId('page'), fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
