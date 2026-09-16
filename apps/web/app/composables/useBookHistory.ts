import { bookHistoryKey } from '~/utils/api-keys';

export type BookHistoryStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

export interface ChangesetRevisionSummary {
  readonly id: string;
  readonly pageId: string;
  readonly createdAt: string;
}

export interface BookChangesetSummary {
  readonly id: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly message: string | null;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly revisions: readonly ChangesetRevisionSummary[];
}

export interface BookHistoryResponse {
  /** The book node's own title and workspace — what the screen names itself by, and where "back to the tree" goes. */
  readonly title: string;
  readonly workspaceId: string;
  readonly changesets: readonly BookChangesetSummary[];
}

export type BookHistoryFetcher = (bookId: string) => Promise<BookHistoryResponse>;

export interface UseBookHistoryResult {
  readonly status: Ref<BookHistoryStatus>;
  readonly title: ComputedRef<string>;
  /** `null` until a successful response names it. */
  readonly workspaceId: ComputedRef<string | null>;
  readonly changesets: ComputedRef<readonly BookChangesetSummary[]>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the list already on screen — refresh behind it. */
  readonly load: () => Promise<void>;
}

/**
 * `GET /books/:id/history` (changesets spec: "Book-Level History Is One
 * Query"; task 10.5). Mirrors `usePageHistory`'s non-disclosure shape
 * exactly: absence and denial-of-read collapse into the SAME `not-found`
 * status, because the route itself (`apps/api/src/routes/revisions.ts`)
 * already returns a byte-identical 404 for both — a distinct `forbidden`
 * branch here would defeat that on the one client that happens to see a 403
 * rather than a 404.
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `bookHistoryKey`): server-rendered when the request can be
 * authenticated, kept across screens, and cleared by `useSavePage` on any
 * save — the save does not say which book it lands in.
 */
export function useBookHistory(bookId: string, fetcher?: BookHistoryFetcher): UseBookHistoryResult {
  const get =
    fetcher ??
    ((id: string) => {
      const api = useApiClient();
      return api<BookHistoryResponse>(`/books/${id}/history`);
    });

  const read = useApiRead<BookHistoryResponse>(bookHistoryKey(bookId), () => get(bookId));
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
  const changesets = computed(() => value.value?.changesets ?? []);
  const MESSAGES: Record<BookHistoryStatus, string> = {
    'idle': '',
    'loading': 'Loading changeset history…',
    'success': '',
    'unauthenticated': 'Your session has ended.',
    'not-found': 'This book does not exist.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);

  return { status, title, workspaceId, changesets, message, load: read.load };
}
