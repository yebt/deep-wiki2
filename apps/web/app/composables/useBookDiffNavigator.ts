import type { BookDiffFetcher, BookDiffStatus, ChangedPageDiff } from './useBookDiff';
import { useBookDiff } from './useBookDiff';
import type { BookPageDiffFetcher, BookPageDiffStatus, BookPageHistoryFetcher } from './useBookPageDiff';
import { useBookPageDiff } from './useBookPageDiff';
import type { PageDiff } from './usePageDiff';

export interface UseBookDiffNavigatorDeps {
  readonly bookDiffFetcher?: BookDiffFetcher;
  readonly historyFetcher?: BookPageHistoryFetcher;
  readonly diffFetcher?: BookPageDiffFetcher;
  /** Deep-link support: focus this page on load if it is among the changed pages, per `?page=` in the URL. */
  readonly initialPageId?: string;
}

export interface UseBookDiffNavigatorResult {
  /** The changed-page LIST's own status — fetched exactly once by `load()`. */
  readonly status: Ref<BookDiffStatus>;
  readonly message: Ref<string>;
  readonly pageSummaries: Ref<readonly ChangedPageDiff[]>;
  readonly pageIds: ComputedRef<readonly string[]>;
  readonly currentIndex: Ref<number>;
  readonly currentPageId: ComputedRef<string | null>;
  readonly hasPrev: ComputedRef<boolean>;
  readonly hasNext: ComputedRef<boolean>;
  /** The FOCUSED page's own diff — this is what changes on `next()`/`prev()`/`goTo()`; the list above never re-fetches. */
  readonly currentPageStatus: Ref<BookPageDiffStatus | 'idle'>;
  readonly currentPageDiff: Ref<PageDiff | null>;
  readonly currentPageMessage: Ref<string>;
  readonly load: () => Promise<void>;
  readonly goTo: (index: number) => Promise<void>;
  readonly next: () => Promise<void>;
  readonly prev: () => Promise<void>;
}

/**
 * Between-pages navigation for the book-diff screen
 * (docs/UI-CHECKLIST.md §4.7: "Book-level (changeset) diff is navigable:
 * the user can move between changed pages without returning to a list").
 *
 * **The rule:** the changed-page list (`useBookDiff`) is fetched exactly
 * once, by `load()`. `next()`/`prev()`/`goTo()` only ever swap which page's
 * own diff (`useBookPageDiff`) is focused — they never re-fetch the list
 * and the screen built on this composable never routes back to one. This
 * is what "navigable... without returning to a list" means mechanically:
 * the list is state already held, not a screen to revisit.
 */
export function useBookDiffNavigator(bookId: string, since: string, deps: UseBookDiffNavigatorDeps = {}): UseBookDiffNavigatorResult {
  const list = useBookDiff(bookId, since, deps.bookDiffFetcher);

  const currentIndex = ref(0);
  const currentPageStatus = ref<BookPageDiffStatus | 'idle'>('idle');
  const currentPageDiff = ref<PageDiff | null>(null);
  const currentPageMessage = ref('');

  const pageIds = computed(() => list.pages.value.map((page) => page.pageId));
  const currentPageId = computed<string | null>(() => pageIds.value[currentIndex.value] ?? null);
  const hasPrev = computed(() => currentIndex.value > 0);
  const hasNext = computed(() => currentIndex.value < pageIds.value.length - 1);

  async function loadFocusedPage(): Promise<void> {
    const pageId = currentPageId.value;
    if (!pageId) {
      currentPageStatus.value = 'idle';
      currentPageDiff.value = null;
      currentPageMessage.value = '';
      return;
    }
    currentPageStatus.value = 'loading';
    const page = useBookPageDiff(pageId, since, { historyFetcher: deps.historyFetcher, diffFetcher: deps.diffFetcher });
    await page.load();
    currentPageStatus.value = page.status.value;
    currentPageDiff.value = page.diff.value;
    currentPageMessage.value = page.message.value;
  }

  async function load(): Promise<void> {
    await list.load();
    if (list.status.value !== 'success') return;

    const deepLinkIndex = deps.initialPageId ? pageIds.value.indexOf(deps.initialPageId) : -1;
    currentIndex.value = deepLinkIndex >= 0 ? deepLinkIndex : 0;
    await loadFocusedPage();
  }

  async function goTo(index: number): Promise<void> {
    if (index < 0 || index >= pageIds.value.length || index === currentIndex.value) return;
    currentIndex.value = index;
    await loadFocusedPage();
  }

  async function next(): Promise<void> {
    if (hasNext.value) await goTo(currentIndex.value + 1);
  }

  async function prev(): Promise<void> {
    if (hasPrev.value) await goTo(currentIndex.value - 1);
  }

  return {
    status: list.status,
    message: list.message,
    pageSummaries: list.pages,
    pageIds,
    currentIndex,
    currentPageId,
    hasPrev,
    hasNext,
    currentPageStatus,
    currentPageDiff,
    currentPageMessage,
    load,
    goTo,
    next,
    prev,
  };
}
