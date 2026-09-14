import { describe, expect, test, vi } from 'vitest';
import { useBookPageDiff } from './useBookPageDiff';

/**
 * The book-diff screen's per-page diff. `GET /books/:id/diff?since=` never
 * attaches block text or revision ids to a changed page (`useBookDiff`'s
 * own note) — this composable reconstructs the same "revision immediately
 * preceding `since`" that `packages/db/src/changesets/book-diff.ts`'s
 * `listChangedPagesSince` computes server-side, from `GET
 * /pages/:id/history`'s already-public revision list (newest-first, per
 * revision-history spec), then asks `GET /pages/:id/diff?from=&to=` for the
 * real, text-bearing diff — reusing the exact endpoint `usePageDiff` calls.
 *
 * A page whose only revisions all postdate `since` (created during the
 * window being viewed) has no baseline to diff against — `degraded`, not an
 * error, per docs/UI-CHECKLIST.md §3's "recoverable, not a dead end".
 */
describe('useBookPageDiff', () => {
  const SINCE = '2026-01-02T00:00:00.000Z';

  test('finds the revision immediately preceding `since` — not the oldest one — and diffs it against the latest', async () => {
    // Newest-first, exactly as GET /pages/:id/history returns them. Three
    // candidates predate `since`; the NEAREST one (rev-2) must be picked,
    // not rev-1 (too old) and not rev-3 (the current, post-`since` latest).
    const revisions = [
      { id: 'rev-3', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-03T00:00:00.000Z', changesetId: 'cs-2' },
      { id: 'rev-2', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-01T12:00:00.000Z', changesetId: 'cs-1' },
      { id: 'rev-1', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-01T00:00:00.000Z', changesetId: 'cs-1' },
    ];
    const historyFetcher = vi.fn(async () => ({ revisions }));
    const diff = {
      from: { id: 'rev-2', createdAt: '2026-01-01T12:00:00.000Z' },
      to: { id: 'rev-3', createdAt: '2026-01-03T00:00:00.000Z' },
      changes: [{ kind: 'added' as const, id: 'b1', slot: 0, text: 'New paragraph.' }],
    };
    const diffFetcher = vi.fn(async () => ({ diff }));

    const { status, diff: result, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher });

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(result.value).toEqual(diff);
    expect(historyFetcher).toHaveBeenCalledWith('page-1');
    expect(diffFetcher).toHaveBeenCalledWith('page-1', 'rev-2', 'rev-3');
  });

  test('a page with no revision before `since` (created during this window) degrades gracefully, never crashes, and calls no diff', async () => {
    const revisions = [{ id: 'rev-1', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-03T00:00:00.000Z', changesetId: 'cs-2' }];
    const historyFetcher = vi.fn(async () => ({ revisions }));
    const diffFetcher = vi.fn(async () => {
      throw new Error('must not be called');
    });

    const { status, diff: result, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher });

    await load();

    expect(status.value).toBe('degraded');
    expect(result.value).toBeNull();
    expect(diffFetcher).not.toHaveBeenCalled();
  });

  test('a page with zero revisions degrades rather than throwing', async () => {
    const historyFetcher = vi.fn(async () => ({ revisions: [] }));
    const diffFetcher = vi.fn(async () => {
      throw new Error('must not be called');
    });

    const { status, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher });

    await load();

    expect(status.value).toBe('degraded');
    expect(diffFetcher).not.toHaveBeenCalled();
  });

  test('a 404 on the history fetch (absence or denial, indistinguishable) resolves to not-found', async () => {
    const historyFetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const diffFetcher = vi.fn();

    const { status, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher });

    await load();

    expect(status.value).toBe('not-found');
    expect(diffFetcher).not.toHaveBeenCalled();
  });

  test('a 403 on the history fetch ALSO resolves to not-found', async () => {
    const historyFetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });

    const { status, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher: vi.fn() });

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a 404 on the diff fetch itself (e.g. a pruned revision) also resolves to not-found', async () => {
    const revisions = [
      { id: 'rev-2', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-03T00:00:00.000Z', changesetId: 'cs-2' },
      { id: 'rev-1', authorId: 'u1', authorDisplayName: 'Ada', createdAt: '2026-01-01T00:00:00.000Z', changesetId: 'cs-1' },
    ];
    const historyFetcher = vi.fn(async () => ({ revisions }));
    const diffFetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });

    const { status, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher });

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const historyFetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });

    const { status, message, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher: vi.fn() });

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const historyFetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { revisions: [] };
    });

    const { status, load } = useBookPageDiff('page-1', SINCE, { historyFetcher, diffFetcher: vi.fn() });

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('degraded');
  });
});
