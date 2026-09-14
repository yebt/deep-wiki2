import type { BookDiffResponse, ChangedPageDiffPayload } from '@deep-wiki/contracts';

export type BookDiffStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'network-error';

/** One changed page as `GET /books/:id/diff` returns it — text-bearing changes, both revision ids, and the page's title. */
export type ChangedPageDiff = ChangedPageDiffPayload;

export type BookDiffFetcher = (bookId: string, since: string) => Promise<BookDiffResponse>;

export interface UseBookDiffResult {
  readonly status: Ref<BookDiffStatus>;
  /** The book's own title, once the response names it. */
  readonly title: Ref<string>;
  /** `null` until a successful response names it — where "back to the tree" goes. */
  readonly workspaceId: Ref<string | null>;
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
 * This is the book-diff screen's only request. The route answers with the
 * book's title and workspace and, per changed page, the page's title, its
 * baseline and latest revision ids and the same text-bearing
 * `DiffBlockChangeSchema` changes the page-level route returns
 * (`packages/contracts/src/diff.ts`). Until it did, the screen re-derived
 * the revision ids from `GET /pages/:id/history` and re-fetched the text
 * from `GET /pages/:id/diff` for every focused page — the N+1
 * `packages/db/src/changesets/book-diff.ts` exists to avoid, reintroduced
 * client-side. That composable is gone; this is what replaced it.
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
  const title = ref('');
  const workspaceId = ref<string | null>(null);
  const pages = ref<readonly ChangedPageDiff[]>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading changed pages…';

    try {
      const response = await get(bookId, since);
      title.value = response.title;
      workspaceId.value = response.workspaceId;
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

  return { status, title, workspaceId, pages, message, load };
}
