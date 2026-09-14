export type BookDiffStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'network-error';

/**
 * The raw `BlockChange` shape (`packages/core/src/content/diff.ts`), with
 * every variant's fields folded into one loose type: `apps/api/src/routes/
 * diff.ts`'s book-level route returns `diffBlocks()`'s own output
 * unvalidated by any zod schema (unlike the page-level route, there is no
 * `PageDiffResponseSchema`-equivalent for it), so this composable reads it
 * defensively rather than assuming a discriminated union survived JSON
 * round-tripping untouched.
 */
export interface BookDiffBlockChange {
  readonly kind: 'added' | 'removed' | 'modified' | 'moved' | 'unchanged';
  readonly id: string;
  readonly slot?: number;
  readonly fromSlot?: number;
  readonly toSlot?: number;
  readonly splitFrom?: string;
  readonly mergedInto?: string;
  readonly moved?: boolean;
}

export interface ChangedPageDiff {
  readonly pageId: string;
  readonly diff: { readonly changes: readonly BookDiffBlockChange[] };
}

export interface BookDiffResponse {
  readonly pages: readonly ChangedPageDiff[];
}

export type BookDiffFetcher = (bookId: string, since: string) => Promise<BookDiffResponse>;

export interface UseBookDiffResult {
  readonly status: Ref<BookDiffStatus>;
  readonly pages: Ref<readonly ChangedPageDiff[]>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
}

/**
 * `GET /books/:id/diff?since=` (block-diff spec: "Book-Level Diff
 * Aggregates Changed Pages Since A Date"; task 10.5). Deliberately a SINGLE
 * `not-found` status for both 403 and 404, the same non-disclosure
 * precedent `usePageDiff`/`useBookHistory` follow.
 *
 * This is the *overview* fetch only — which pages changed, and each
 * change's classification with no block text (the route does not attach
 * any; see `BookDiffBlockChange`'s note). The book-diff screen pairs this
 * with `useBookPageDiff` to render one page's full, text-bearing diff at a
 * time as the reader moves between changed pages.
 */
export function useBookDiff(bookId: string, since: string, fetcher?: BookDiffFetcher): UseBookDiffResult {
  const get =
    fetcher ??
    ((id: string, sinceParam: string) => {
      const config = useRuntimeConfig();
      return $fetch<BookDiffResponse>(`${config.public.apiBaseUrl}/books/${id}/diff`, {
        credentials: 'include',
        query: { since: sinceParam },
      });
    });

  const status = ref<BookDiffStatus>('idle');
  const pages = ref<readonly ChangedPageDiff[]>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading changed pages…';

    try {
      const response = await get(bookId, since);
      pages.value = response.pages;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403 || code === 404) {
        status.value = 'not-found';
        message.value = 'This book does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, pages, message, load };
}
