export type BookHistoryStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'network-error';

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
  readonly title: Ref<string>;
  /** `null` until a successful response names it. */
  readonly workspaceId: Ref<string | null>;
  readonly changesets: Ref<readonly BookChangesetSummary[]>;
  readonly message: Ref<string>;
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
 */
export function useBookHistory(bookId: string, fetcher?: BookHistoryFetcher): UseBookHistoryResult {
  const get =
    fetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch<BookHistoryResponse>(`${config.public.apiBaseUrl}/books/${id}/history`, { credentials: 'include' });
    });

  const status = ref<BookHistoryStatus>('idle');
  const title = ref('');
  const workspaceId = ref<string | null>(null);
  const changesets = ref<readonly BookChangesetSummary[]>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading changeset history…';

    try {
      const response = await get(bookId);
      title.value = response.title;
      workspaceId.value = response.workspaceId;
      changesets.value = response.changesets;
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

  return { status, title, workspaceId, changesets, message, load };
}
