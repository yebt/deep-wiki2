import { describe, expect, test, vi } from 'vitest';
import { useBookDiff } from './useBookDiff';

/**
 * `GET /books/:id/diff?since=` (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"). Unlike `GET /pages/:id/diff`,
 * this route (`apps/api/src/routes/diff.ts`) does not attach block text or
 * a page title to each change — `attachBlockText()` runs only on the
 * page-level route — so this composable only ever carries the
 * classification summary (kind, slot(s)) per page. The book-diff screen
 * uses it to build the "which pages changed" list and per-page
 * summary badges, then asks `useBookPageDiff` for a specific page's full,
 * text-bearing diff.
 */
describe('useBookDiff', () => {
  test('starts idle and moves through loading to success with the changed pages as the server sent them', async () => {
    const pages = [
      { pageId: 'page-1', diff: { changes: [{ kind: 'added' as const, id: 'b1', slot: 0 }] } },
      { pageId: 'page-2', diff: { changes: [{ kind: 'moved' as const, id: 'b2', fromSlot: 0, toSlot: 1 }] } },
    ];
    const fetcher = vi.fn(async () => ({ pages }));
    const { status, pages: result, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(result.value).toEqual(pages);
    expect(fetcher).toHaveBeenCalledWith('book-1', '2026-01-01T00:00:00.000Z');
  });

  test('no pages changed since the given date resolves to success with an empty list, not an error', async () => {
    const fetcher = vi.fn(async () => ({ pages: [] }));
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
      return { pages: [] };
    });
    const { status, load } = useBookDiff('book-1', '2026-01-01T00:00:00.000Z', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
