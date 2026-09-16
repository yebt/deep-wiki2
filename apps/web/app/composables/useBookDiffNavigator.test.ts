import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { nextTick, ref } from 'vue';
import type { BookDiffResponse, ChangedPageDiffPayload } from '@deep-wiki/contracts';
import { useBookDiffNavigator } from './useBookDiffNavigator';

/**
 * The book-diff screen's between-pages navigation (block-diff spec:
 * "Book-Level Diff Aggregates Changed Pages Since A Date";
 * docs/UI-CHECKLIST.md §4.7: "Book-level (changeset) diff is navigable: the
 * user can move between changed pages without returning to a list").
 *
 * `GET /books/:id/diff?since=` now carries each changed page's text, its
 * baseline and latest revision ids and its title, so the whole screen is
 * ONE request: `next()`/`prev()`/`goTo()` only ever change which of the
 * already-held pages is focused, and nothing is fetched per page. A test
 * that only ever inspects the FIRST page after `load()` cannot tell this
 * composable apart from one that ignores `next()`/`prev()` entirely, so
 * every navigation test below drives to a second (or later) page and
 * asserts ITS OWN content — the trap named in tasks.md 10.5.
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

describe('useBookDiffNavigator', () => {
  const SINCE = '2026-01-02T00:00:00.000Z';

  function page(id: string, overrides: Partial<ChangedPageDiffPayload> = {}): ChangedPageDiffPayload {
    return {
      pageId: id,
      pageTitle: `Title of ${id}`,
      baselineRevisionId: `${id}-rev-1`,
      latestRevisionId: `${id}-rev-2`,
      diff: { changes: [{ kind: 'added', id: `${id}-block`, slot: 0, text: `Content for ${id}` }] },
      ...overrides,
    };
  }

  function makeDeps(pages: readonly ChangedPageDiffPayload[] = [page('page-1'), page('page-2')]) {
    const response: BookDiffResponse = { title: 'Handbook', workspaceId: 'ws-1', pages: [...pages] };
    const bookDiffFetcher = vi.fn(async () => response);
    return { bookDiffFetcher };
  }

  // The client-side N+1 this composable used to carry — `GET /pages/:id/history`
  // plus `GET /pages/:id/diff` per focused page, through `useBookPageDiff` —
  // is gone with the module that did it. A mock of those endpoints would let
  // a navigator that still called them pass, so the guard is structural:
  // the module must not exist.
  test('the per-page history/diff workaround no longer exists in the codebase', () => {
    const modules = import.meta.glob('./useBookPageDiff*');
    expect(Object.keys(modules)).toEqual([]);
  });

  test('load() fetches the book diff exactly once, names the book, and focuses the first page with its own text', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator(nextId('book'), SINCE, deps);

    await nav.load();

    expect(nav.status.value).toBe('success');
    expect(nav.title.value).toBe('Handbook');
    expect(nav.workspaceId.value).toBe('ws-1');
    expect(nav.pageIds.value).toEqual(['page-1', 'page-2']);
    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentPage.value?.pageTitle).toBe('Title of page-1');
    expect(nav.currentPage.value?.diff.changes[0]).toMatchObject({ text: 'Content for page-1' });
    expect(deps.bookDiffFetcher).toHaveBeenCalledTimes(1);
  });

  test('next() moves to the second page and shows ITS OWN diff — with no further request of any kind', async () => {
    const deps = makeDeps();
    const nav = useBookDiffNavigator(nextId('book'), SINCE, deps);
    await nav.load();

    nav.next();

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentPage.value?.pageId).toBe('page-2');
    expect(nav.currentPage.value?.pageTitle).toBe('Title of page-2');
    expect(nav.currentPage.value?.diff.changes[0]).toMatchObject({ text: 'Content for page-2' });
    expect(deps.bookDiffFetcher).toHaveBeenCalledTimes(1);
  });

  test('prev() from the second page returns to the first with its own content restored', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps());
    await nav.load();
    nav.next();

    nav.prev();

    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentPage.value?.diff.changes[0]).toMatchObject({ text: 'Content for page-1' });
  });

  test('hasNext/hasPrev report the boundaries, and moving past an edge is a no-op', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps());
    await nav.load();

    expect(nav.hasPrev.value).toBe(false);
    expect(nav.hasNext.value).toBe(true);
    nav.prev();
    expect(nav.currentIndex.value).toBe(0);

    nav.next();
    expect(nav.hasPrev.value).toBe(true);
    expect(nav.hasNext.value).toBe(false);
    nav.next();
    expect(nav.currentIndex.value).toBe(1);
  });

  test('goTo jumps directly to an arbitrary changed page', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps([page('page-1'), page('page-2'), page('page-3')]));
    await nav.load();

    nav.goTo(2);

    expect(nav.currentIndex.value).toBe(2);
    expect(nav.currentPage.value?.pageId).toBe('page-3');
  });

  test('an initial page id deep-links to that page instead of the first one', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, { ...makeDeps(), initialPageId: 'page-2' });

    await nav.load();

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentPage.value?.pageId).toBe('page-2');
  });

  test('an initial page id absent from the changed set falls back to the first page rather than a dead state', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, { ...makeDeps(), initialPageId: 'not-a-changed-page' });

    await nav.load();

    expect(nav.currentIndex.value).toBe(0);
  });

  // A page whose first revision landed after `since` has nothing to diff
  // against: the route says so with `baselineRevisionId: null`, and that is
  // the screen's "created during this window" state, not a crash.
  test('a page with no baseline revision is reported as such through the page itself', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps([page('page-1', { baselineRevisionId: null, diff: { changes: [] } })]));
    await nav.load();

    expect(nav.currentPage.value?.baselineRevisionId).toBeNull();
  });

  test('zero changed pages resolves to success with an empty, navigable-nowhere state, not an error', async () => {
    const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps([]));

    await nav.load();

    expect(nav.status.value).toBe('success');
    expect(nav.pageIds.value).toEqual([]);
    expect(nav.currentPage.value).toBeNull();
    expect(nav.hasNext.value).toBe(false);
    expect(nav.hasPrev.value).toBe(false);
  });

  test('a denied or missing book resolves to not-found', async () => {
    const bookDiffFetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const nav = useBookDiffNavigator(nextId('book'), SINCE, { bookDiffFetcher });

    await nav.load();

    expect(nav.status.value).toBe('not-found');
    expect(nav.currentPage.value).toBeNull();
  });

  test('a network failure resolves to the recoverable network-error state', async () => {
    const bookDiffFetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const nav = useBookDiffNavigator(nextId('book'), SINCE, { bookDiffFetcher });

    await nav.load();

    expect(nav.status.value).toBe('network-error');
  });

  /**
   * `GET /books/:id/diff` orders changed pages by `page_id`
   * (docs/TODO.md Findings, 2026-09-14), so the switcher needs its own
   * order. `pageOrder` is the tree's; when it places every changed page,
   * the API's own order is irrelevant. Deliberately NOT already-sorted in
   * either the API response or the title order, so a navigator that
   * ignored `pageOrder` and fell through to one of those would fail —
   * the trap tasks.md names for an ordering test whose fixture happens to
   * already be in the right order.
   */
  describe('page order', () => {
    const banana = page('page-banana', { pageTitle: 'Banana' });
    const apple = page('page-apple', { pageTitle: 'Apple' });
    const cherry = page('page-cherry', { pageTitle: 'Cherry' });
    // API order: Banana, Apple, Cherry. Title order: Apple, Banana, Cherry.
    // Tree order (below): Cherry, Banana, Apple — distinct from both.
    const apiOrderPages = [banana, apple, cherry];
    const TREE_POSITION: Record<string, number> = { 'page-cherry': 0, 'page-banana': 1, 'page-apple': 2 };

    test('orders by tree position when the tree places every changed page — not API order, not title order', async () => {
      const deps = { ...makeDeps(apiOrderPages), pageOrder: (pageId: string) => TREE_POSITION[pageId] };
      const nav = useBookDiffNavigator(nextId('book'), SINCE, deps);

      await nav.load();

      expect(nav.pageIds.value).toEqual(['page-cherry', 'page-banana', 'page-apple']);
    });

    test('falls back to title order when the tree has not (yet) placed one of the changed pages', async () => {
      // Missing 'page-apple' — the tree has not loaded it in yet.
      const partial: Record<string, number> = { 'page-cherry': 0, 'page-banana': 1 };
      const deps = { ...makeDeps(apiOrderPages), pageOrder: (pageId: string) => partial[pageId] };
      const nav = useBookDiffNavigator(nextId('book'), SINCE, deps);

      await nav.load();

      expect(nav.pageIds.value).toEqual(['page-apple', 'page-banana', 'page-cherry']);
    });

    test('falls back to title order when no pageOrder is supplied at all', async () => {
      const nav = useBookDiffNavigator(nextId('book'), SINCE, makeDeps(apiOrderPages));

      await nav.load();

      expect(nav.pageIds.value).toEqual(['page-apple', 'page-banana', 'page-cherry']);
    });

    test('re-sorts reactively once the tree places pages that were previously unplaced, keeping the focused page focused by id', async () => {
      const order = ref<Record<string, number>>({ 'page-cherry': 0, 'page-banana': 1 });
      const deps = { ...makeDeps(apiOrderPages), pageOrder: (pageId: string) => order.value[pageId] };
      const nav = useBookDiffNavigator(nextId('book'), SINCE, deps);
      await nav.load();
      // Falls back to title order first: Apple, Banana, Cherry — focused page is Apple.
      expect(nav.currentPage.value?.pageId).toBe('page-apple');

      // The tree finishes loading and now places every page.
      order.value = { ...TREE_POSITION };
      await nextTick();

      expect(nav.pageIds.value).toEqual(['page-cherry', 'page-banana', 'page-apple']);
      // Still Apple — the focus followed its id, not its old numeric slot.
      expect(nav.currentPage.value?.pageId).toBe('page-apple');
    });
  });
});
