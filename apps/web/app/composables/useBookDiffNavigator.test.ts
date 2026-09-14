import { describe, expect, test, vi } from 'vitest';
import type { ChangedPageDiff } from './useBookDiff';
import { useBookDiffNavigator } from './useBookDiffNavigator';

/**
 * The book-diff screen's between-pages navigation (block-diff spec:
 * "Book-Level Diff Aggregates Changed Pages Since A Date";
 * docs/UI-CHECKLIST.md §4.7: "Book-level (changeset) diff is navigable: the
 * user can move between changed pages without returning to a list").
 *
 * The rule this composable encodes: the changed-pages LIST is fetched
 * exactly once (`useBookDiff`); moving `next()`/`prev()` only ever swaps
 * which page's own diff (`useBookPageDiff`) is focused — the list itself
 * never re-fetches and the screen never navigates back to it. A test that
 * only ever inspects the FIRST page after `load()` cannot tell this
 * composable apart from one that ignores `next()`/`prev()` entirely, so
 * every navigation test below drives to a second (or later) page and
 * asserts ITS OWN content — the specific trap named in tasks.md 10.5.
 */
describe('useBookDiffNavigator', () => {
  const SINCE = '2026-01-02T00:00:00.000Z';

  function makeDeps(overrides: { pages?: readonly ChangedPageDiff[] } = {}) {
    const pages: readonly ChangedPageDiff[] = overrides.pages ?? [
      { pageId: 'page-1', diff: { changes: [{ kind: 'added', id: 'b1', slot: 0 }] } },
      { pageId: 'page-2', diff: { changes: [{ kind: 'moved', id: 'b2', fromSlot: 0, toSlot: 1 }] } },
    ];
    const bookDiffFetcher = vi.fn(async () => ({ pages }));
    const historyFetcher = vi.fn(async (pageId: string) => ({
      revisions: [
        { id: `${pageId}-rev-2`, createdAt: '2026-01-03T00:00:00.000Z' },
        { id: `${pageId}-rev-1`, createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    }));
    const diffFetcher = vi.fn(async (pageId: string, from: string, to: string) => ({
      diff: {
        from: { id: from, createdAt: '2026-01-01T00:00:00.000Z' },
        to: { id: to, createdAt: '2026-01-03T00:00:00.000Z' },
        changes: [{ kind: 'added' as const, id: `${pageId}-block`, slot: 0, text: `Content for ${pageId}` }],
      },
    }));
    return { bookDiffFetcher, historyFetcher, diffFetcher };
  }

  test('load() fetches the changed-page list once and auto-focuses the first page', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, deps);

    await nav.load();

    expect(nav.status.value).toBe('success');
    expect(nav.pageIds.value).toEqual(['page-1', 'page-2']);
    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentPageId.value).toBe('page-1');
    expect(nav.currentPageStatus.value).toBe('success');
    expect(nav.currentPageDiff.value?.changes[0]).toMatchObject({ text: 'Content for page-1' });
    expect(deps.bookDiffFetcher).toHaveBeenCalledTimes(1);
    expect(deps.historyFetcher).toHaveBeenCalledTimes(1);
    expect(deps.historyFetcher).toHaveBeenCalledWith('page-1');
  });

  test('next() moves to the second page and loads ITS OWN diff — not a re-render of the first', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, deps);
    await nav.load();

    await nav.next();

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentPageId.value).toBe('page-2');
    expect(nav.currentPageDiff.value?.changes[0]).toMatchObject({ text: 'Content for page-2' });
    // The list fetch never repeats — navigation never "returns to a list".
    expect(deps.bookDiffFetcher).toHaveBeenCalledTimes(1);
    expect(deps.historyFetcher).toHaveBeenCalledWith('page-2');
  });

  test('prev() from the second page returns to the first with its own content restored', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, deps);
    await nav.load();
    await nav.next();

    await nav.prev();

    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentPageId.value).toBe('page-1');
    expect(nav.currentPageDiff.value?.changes[0]).toMatchObject({ text: 'Content for page-1' });
  });

  test('hasNext/hasPrev report the boundaries correctly, and moving past an edge is a no-op', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, deps);
    await nav.load();

    expect(nav.hasPrev.value).toBe(false);
    expect(nav.hasNext.value).toBe(true);

    await nav.prev(); // no-op at the start
    expect(nav.currentIndex.value).toBe(0);

    await nav.next();
    expect(nav.hasPrev.value).toBe(true);
    expect(nav.hasNext.value).toBe(false);

    await nav.next(); // no-op at the end
    expect(nav.currentIndex.value).toBe(1);
  });

  test('goTo jumps directly to an arbitrary changed page, e.g. from a page switcher menu', async () => {
    const deps = makeDeps({
      pages: [
        { pageId: 'page-1', diff: { changes: [] } },
        { pageId: 'page-2', diff: { changes: [] } },
        { pageId: 'page-3', diff: { changes: [] } },
      ],
    });
    const nav = useBookDiffNavigator('book-1', SINCE, deps);
    await nav.load();

    await nav.goTo(2);

    expect(nav.currentIndex.value).toBe(2);
    expect(nav.currentPageId.value).toBe('page-3');
    expect(deps.historyFetcher).toHaveBeenCalledWith('page-3');
  });

  test('an initial page id deep-links to that page instead of the first one', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, { ...deps, initialPageId: 'page-2' });

    await nav.load();

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentPageId.value).toBe('page-2');
  });

  test('an initial page id absent from the changed set falls back to the first page rather than a dead state', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator('book-1', SINCE, { ...deps, initialPageId: 'not-a-changed-page' });

    await nav.load();

    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentPageId.value).toBe('page-1');
  });

  test('zero changed pages resolves to success with an empty, navigable-nowhere state, not an error', async () => {
    const deps = makeDeps({ pages: [] });
    const nav = useBookDiffNavigator('book-1', SINCE, deps);

    await nav.load();

    expect(nav.status.value).toBe('success');
    expect(nav.pageIds.value).toEqual([]);
    expect(nav.currentPageId.value).toBeNull();
    expect(nav.hasNext.value).toBe(false);
    expect(nav.hasPrev.value).toBe(false);
    expect(deps.historyFetcher).not.toHaveBeenCalled();
  });

  test('a denied or missing book resolves to not-found and never attempts a per-page fetch', async () => {
    const bookDiffFetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const historyFetcher = vi.fn();
    const diffFetcher = vi.fn();
    const nav = useBookDiffNavigator('book-1', SINCE, { bookDiffFetcher, historyFetcher, diffFetcher });

    await nav.load();

    expect(nav.status.value).toBe('not-found');
    expect(historyFetcher).not.toHaveBeenCalled();
  });

  test('a network failure on the list fetch resolves to the recoverable network-error state', async () => {
    const bookDiffFetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const nav = useBookDiffNavigator('book-1', SINCE, { bookDiffFetcher, historyFetcher: vi.fn(), diffFetcher: vi.fn() });

    await nav.load();

    expect(nav.status.value).toBe('network-error');
  });
});
