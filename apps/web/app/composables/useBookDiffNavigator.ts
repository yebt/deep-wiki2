import type { BookDiffFetcher, BookDiffStatus, ChangedPageDiff } from './useBookDiff';
import { useBookDiff } from './useBookDiff';
import type { NodeLocation } from './useNodeLocation';

export interface UseBookDiffNavigatorDeps {
  readonly bookDiffFetcher?: BookDiffFetcher;
  /** Deep-link support: focus this page on load if it is among the changed pages, per `?page=` in the URL. */
  readonly initialPageId?: string;
  /**
   * Client-side order for the page switcher. `GET /books/:id/diff` orders
   * changed pages by `page_id` (`packages/db/src/changesets/book-diff.ts`'s
   * `ORDER BY page_id, created_at DESC`), an id the database mints at
   * random — not tree position — so without this the switcher's order
   * would be arbitrary on every load (docs/TODO.md Findings, 2026-09-14;
   * the server should order instead, this is the stand-in until it does).
   *
   * Answers a changed page's position in a pre-order walk of the workspace
   * tree (`~/utils/tree-order`'s `buildTreeOrderIndex`), or `undefined`
   * while the tree has not placed that page yet — it can still be loading
   * in the sidebar the layout mounts alongside this screen. Pages are
   * ordered by tree position only when EVERY changed page has a position;
   * otherwise, and whenever this is omitted, pages fall back to title
   * order (locale-aware), which needs nothing async and is deterministic.
   * Read reactively on every render, so a tree that finishes loading after
   * the first paint re-sorts the switcher once, from title order to tree
   * order — the focused page stays focused by id, never by its old
   * numeric slot (see `currentPage`).
   */
  readonly pageOrder?: (pageId: string) => number | undefined;
}

export interface UseBookDiffNavigatorResult {
  /** The one request's status — fetched exactly once by `load()`. */
  readonly status: Ref<BookDiffStatus>;
  readonly message: Ref<string>;
  readonly title: Ref<string>;
  readonly workspaceId: Ref<string | null>;
  /** Where the book lives, as the one request says (`NodeLocation`). */
  readonly location: ComputedRef<NodeLocation>;
  /** The changed pages, ordered per `pageOrder`'s own rule above. */
  readonly pages: ComputedRef<readonly ChangedPageDiff[]>;
  readonly pageIds: ComputedRef<readonly string[]>;
  readonly currentIndex: ComputedRef<number>;
  /** The focused page — one of `pages`, with its title, baseline and text. `null` when nothing changed or nothing loaded. */
  readonly currentPage: ComputedRef<ChangedPageDiff | null>;
  readonly currentPageId: ComputedRef<string | null>;
  readonly hasPrev: ComputedRef<boolean>;
  readonly hasNext: ComputedRef<boolean>;
  readonly load: () => Promise<void>;
  readonly goTo: (index: number) => void;
  readonly next: () => void;
  readonly prev: () => void;
}

/**
 * Between-pages navigation for the book-diff screen
 * (docs/UI-CHECKLIST.md §4.7: "Book-level (changeset) diff is navigable:
 * the user can move between changed pages without returning to a list").
 *
 * **The rule:** the book diff (`useBookDiff`) is fetched exactly once, by
 * `load()`, and it carries everything the screen shows — every changed
 * page's title, baseline and text-bearing changes. `next()`/`prev()`/
 * `goTo()` only ever change which of those already-held pages is focused;
 * they fetch nothing, and the screen built on this never routes back to a
 * list. That is what "navigable... without returning to a list" means
 * mechanically: the list is state already held, not a screen to revisit —
 * and, since the route grew its per-page fields, not a request to repeat
 * per page either.
 *
 * **Focus is tracked by page id, not by numeric index.** `pageOrder` can
 * change which position a page sits at after the first paint (the tree
 * finishing its own load), and an index held across a reorder would point
 * at whatever page happens to land in that slot next — a silent focus
 * swap the person never asked for. `currentIndex` is *derived* from the
 * focused id instead, so a reorder can move the focused page's slot
 * without moving the focus itself.
 */
export function useBookDiffNavigator(bookId: string, since: string, deps: UseBookDiffNavigatorDeps = {}): UseBookDiffNavigatorResult {
  const list = useBookDiff(bookId, since, deps.bookDiffFetcher);

  const pages = computed<readonly ChangedPageDiff[]>(() => {
    const raw = list.pages.value;
    const order = deps.pageOrder;
    const placedByTree = order && raw.length > 0 && raw.every((page) => order(page.pageId) !== undefined);
    if (placedByTree) {
      return [...raw].sort((a, b) => order(a.pageId)! - order(b.pageId)!);
    }
    return [...raw].sort((a, b) => a.pageTitle.localeCompare(b.pageTitle));
  });

  const pageIds = computed(() => pages.value.map((page) => page.pageId));
  const focusedPageId = ref<string | null>(null);

  const currentIndex = computed(() => {
    const ids = pageIds.value;
    if (ids.length === 0) return -1;
    const found = focusedPageId.value ? ids.indexOf(focusedPageId.value) : -1;
    return found >= 0 ? found : 0;
  });
  const currentPage = computed<ChangedPageDiff | null>(() => pages.value[currentIndex.value] ?? null);
  const currentPageId = computed<string | null>(() => currentPage.value?.pageId ?? null);
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(() => currentIndex.value >= 0 && currentIndex.value < pageIds.value.length - 1);

  async function load(): Promise<void> {
    await list.load();
    if (list.status.value !== 'success') return;

    focusedPageId.value = deps.initialPageId && pageIds.value.includes(deps.initialPageId) ? deps.initialPageId : (pageIds.value[0] ?? null);
  }

  function goTo(index: number): void {
    const id = pageIds.value[index];
    if (id === undefined) return;
    focusedPageId.value = id;
  }

  function next(): void {
    if (hasNext.value) goTo(currentIndex.value + 1);
  }

  function prev(): void {
    if (hasPrev.value) goTo(currentIndex.value - 1);
  }

  return {
    status: list.status,
    message: list.message,
    title: list.title,
    workspaceId: list.workspaceId,
    location: list.location,
    pages,
    pageIds,
    currentIndex,
    currentPage,
    currentPageId,
    hasPrev,
    hasNext,
    load,
    goTo,
    next,
    prev,
  };
}
