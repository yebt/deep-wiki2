import { describe, expect, test, vi } from 'vitest';
import { useBookHistory } from './useBookHistory';

/**
 * `GET /books/:id/history` (changesets spec: "Book-Level History Is One
 * Query"). Mirrors `usePageHistory`'s non-disclosure shape exactly: absence
 * and denial-of-read collapse into the SAME `not-found` status, because the
 * route itself (`apps/api/src/routes/revisions.ts`) returns a
 * byte-identical 404 for both.
 */
describe('useBookHistory', () => {
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
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', changesets }));
    const { status, title, workspaceId, changesets: result, load } = useBookHistory('book-1', fetcher);

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
    expect(fetcher).toHaveBeenCalledWith('book-1');
  });

  test('a book that exists but has no changesets yet resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', changesets: [] }));
    const { status, changesets: result, load } = useBookHistory('book-1', fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual([]);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = useBookHistory('book-1', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = useBookHistory('book-1', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = useBookHistory('book-1', fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { title: 'Handbook', workspaceId: 'ws-1', changesets: [] };
    });
    const { status, load } = useBookHistory('book-1', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
