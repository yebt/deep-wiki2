import type { BookDiffFetcher, BookDiffStatus, ChangedPageDiff } from './useBookDiff';
import { useBookDiff } from './useBookDiff';

export interface UseBookDiffNavigatorDeps {
  readonly bookDiffFetcher?: BookDiffFetcher;
  /** Deep-link support: focus this page on load if it is among the changed pages, per `?page=` in the URL. */
  readonly initialPageId?: string;
}

export interface UseBookDiffNavigatorResult {
  /** The one request's status — fetched exactly once by `load()`. */
  readonly status: Ref<BookDiffStatus>;
  readonly message: Ref<string>;
  readonly title: Ref<string>;
  readonly workspaceId: Ref<string | null>;
  readonly pages: Ref<readonly ChangedPageDiff[]>;
  readonly pageIds: ComputedRef<readonly string[]>;
  readonly currentIndex: Ref<number>;
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
 */
export function useBookDiffNavigator(bookId: string, since: string, deps: UseBookDiffNavigatorDeps = {}): UseBookDiffNavigatorResult {
  const list = useBookDiff(bookId, since, deps.bookDiffFetcher);

  const currentIndex = ref(0);

  const pageIds = computed(() => list.pages.value.map((page) => page.pageId));
  const currentPage = computed<ChangedPageDiff | null>(() => list.pages.value[currentIndex.value] ?? null);
  const currentPageId = computed<string | null>(() => currentPage.value?.pageId ?? null);
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(() => currentIndex.value < pageIds.value.length - 1);

  async function load(): Promise<void> {
    await list.load();
    if (list.status.value !== 'success') return;

    const deepLinkIndex = deps.initialPageId ? pageIds.value.indexOf(deps.initialPageId) : -1;
    currentIndex.value = deepLinkIndex >= 0 ? deepLinkIndex : 0;
  }

  function goTo(index: number): void {
    if (index < 0 || index >= pageIds.value.length || index === currentIndex.value) return;
    currentIndex.value = index;
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
    pages: list.pages,
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
