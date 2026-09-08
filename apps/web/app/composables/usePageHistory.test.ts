import { describe, expect, test, vi } from 'vitest';
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
describe('usePageHistory', () => {
  test('starts idle and moves through loading to success with the revisions, newest first as the server sent them', async () => {
    const revisions = [
      { id: 'rev-2', authorId: 'user-1', authorDisplayName: 'Ada', createdAt: '2026-01-02T00:00:00.000Z', changesetId: null },
      { id: 'rev-1', authorId: 'user-1', authorDisplayName: 'Ada', createdAt: '2026-01-01T00:00:00.000Z', changesetId: null },
    ];
    const fetcher = vi.fn(async () => ({ revisions }));
    const { status, revisions: result, load } = usePageHistory('page-1', fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(result.value).toEqual(revisions);
    expect(fetcher).toHaveBeenCalledWith('page-1');
  });

  test('a page that exists but has never been saved resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ revisions: [] }));
    const { status, revisions: result, load } = usePageHistory('page-1', fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual([]);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = usePageHistory('page-1', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = usePageHistory('page-1', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageHistory('page-1', fetcher);

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
    const { status, load } = usePageHistory('page-1', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
