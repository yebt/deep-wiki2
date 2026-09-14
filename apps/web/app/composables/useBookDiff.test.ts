import { describe, expect, test, vi } from 'vitest';
import type { ChangedPageDiffPayload } from '@deep-wiki/contracts';
import { useBookDiff } from './useBookDiff';

/**
 * `GET /books/:id/diff?since=` (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"). The route now answers with the
 * whole screen's data — the book's title and workspace, and per changed
 * page its title, both revision ids and text-bearing changes — so this is
 * the book-diff screen's only request.
 */
describe('useBookDiff', () => {
  test('starts idle and moves through loading to success with the book, and the changed pages, as the server sent them', async () => {
    const pages: ChangedPageDiffPayload[] = [
      { pageId: 'page-1', pageTitle: 'Alpha', baselineRevisionId: 'r1', latestRevisionId: 'r2', diff: { changes: [{ kind: 'added', id: 'b1', slot: 0, text: 'New.' }] } },
      { pageId: 'page-2', pageTitle: 'Beta', baselineRevisionId: null, latestRevisionId: 'r3', diff: { changes: [] } },
    ];
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', pages }));
    const { status, title, workspaceId, pages: result, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    expect(status.value).toBe('idle');
    expect(workspaceId.value).toBeNull();
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(title.value).toBe('Handbook');
    expect(workspaceId.value).toBe('ws-1');
    expect(result.value).toEqual(pages);
    expect(result.value[0]!.diff.changes[0]).toMatchObject({ text: 'New.' });
    expect(fetcher).toHaveBeenCalledWith('book-1', '2026-01-01T00:00:00.000Z');
  });

  test('no pages changed since the given date resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ title: 'Handbook', workspaceId: 'ws-1', pages: [] }));
    const { status, pages: result, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual([]);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { title: 'Handbook', workspaceId: 'ws-1', pages: [] };
    });
    const { status, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
