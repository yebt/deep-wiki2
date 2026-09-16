import type { BookDiffResponse, ChangedPageDiffPayload } from '@deep-wiki/contracts';
import { bookDiffKey } from '~/utils/api-keys';

export type BookDiffStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

/** One changed page as `GET /books/:id/diff` returns it — text-bearing changes, both revision ids, and the page's title. */
export type ChangedPageDiff = ChangedPageDiffPayload;

export type BookDiffFetcher = (bookId: string, since: string) => Promise<BookDiffResponse>;

export interface UseBookDiffResult {
  readonly status: Ref<BookDiffStatus>;
  /** The book's own title, once the response names it. */
  readonly title: ComputedRef<string>;
  /** `null` until a successful response names it — where "back to the tree" goes. */
  readonly workspaceId: ComputedRef<string | null>;
  readonly pages: ComputedRef<readonly ChangedPageDiff[]>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the diff already on screen — refresh behind it. */
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
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `bookDiffKey` — the book and the `since` instant): server-rendered when
 * the request can be authenticated, kept across screens, and cleared by
 * `useSavePage` on any save — "changed since" grows with every revision.
 */
export function useBookDiff(bookId: string, since: string, fetcher?: BookDiffFetcher): UseBookDiffResult {
  const get =
    fetcher ??
    ((id: string, sinceParam: string) => {
      const api = useApiClient();
      return api<BookDiffResponse>(`/books/${id}/diff`, { query: { since: sinceParam } });
    });

  const read = useApiRead<BookDiffResponse>(bookDiffKey(bookId, since), () => get(bookId, since));
  const status = useReadStatus(read, (code) => {
    // Signed out: the screen's next move is sign-in, not a retry
    // (`useSignInRedirect`). Only the browser ever sees it — a 401 during
    // the server's render is "nothing known" (useApiRead).
    if (code === 401) return 'unauthenticated';
    return code === 403 || code === 404 ? 'not-found' : 'network-error';
  });

  const value = computed(() => (read.outcome.value?.ok ? read.outcome.value.value : null));
  const title = computed(() => value.value?.title ?? '');
  const workspaceId = computed(() => value.value?.workspaceId ?? null);
  const pages = computed(() => value.value?.pages ?? []);
  const MESSAGES: Record<BookDiffStatus, string> = {
    'idle': '',
    'loading': 'Loading changed pages…',
    'success': '',
    'unauthenticated': 'Your session has ended.',
    'not-found': 'This book does not exist.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);

  return { status, title, workspaceId, pages, message, load: read.load };
}
