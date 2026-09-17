import { pageHistoryKey } from '~/utils/api-keys';

export type PageHistoryStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

export interface RevisionSummary {
  readonly id: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: string;
  readonly changesetId: string | null;
  /** The stored markdown's hash; equal on two neighbours means the same bytes, which the history screen names (see history.vue). */
  readonly contentHash: string;
}

export interface PageHistoryResponse {
  readonly revisions: readonly RevisionSummary[];
}

export type PageHistoryFetcher = (nodeId: string) => Promise<PageHistoryResponse>;

export interface UsePageHistoryResult {
  readonly status: Ref<PageHistoryStatus>;
  readonly revisions: ComputedRef<readonly RevisionSummary[]>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the list already on screen — refresh behind it. */
  readonly load: () => Promise<void>;
}

/**
 * `GET /pages/:id/history` (revision-history spec: "Page History Query
 * Returns Revisions Newest First"; "History denied without read").
 *
 * Deliberately a SINGLE `not-found` status for both 403 and 404, unlike
 * `usePageRead`'s distinct `forbidden`/`not-found`: the route itself
 * (`apps/api/src/routes/revisions.ts`) already collapses "does not exist"
 * and "exists but you may not read it" into one byte-identical 404, the
 * same non-disclosure precedent `docs/UI-CHECKLIST.md` records for the
 * application's own not-found screen ("selects by status code alone").
 * Reintroducing a 403 branch here would defeat that on the one client
 * that happens to see a 403 rather than a 404.
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `pageHistoryKey`): server-rendered when the request can be
 * authenticated, kept across screens, and cleared by `useSavePage` when
 * this page is saved — the list is newest first, and a save is the newest.
 */
export function usePageHistory(nodeId: string, fetcher?: PageHistoryFetcher): UsePageHistoryResult {
  const get =
    fetcher ??
    ((id: string) => {
      const api = useApiClient();
      return api<PageHistoryResponse>(`/pages/${id}/history`);
    });

  const read = useApiRead<PageHistoryResponse>(pageHistoryKey(nodeId), () => get(nodeId));
  const status = useReadStatus(read, (code) => {
    // Signed out: the screen's next move is sign-in, not a retry
    // (`useSignInRedirect`). Only the browser ever sees it — a 401 during
    // the server's render is "nothing known" (useApiRead).
    if (code === 401) return 'unauthenticated';
    return code === 403 || code === 404 ? 'not-found' : 'network-error';
  });

  const revisions = computed(() => (read.outcome.value?.ok ? read.outcome.value.value.revisions : []));
  const MESSAGES: Record<PageHistoryStatus, string> = {
    'idle': '',
    'loading': 'Loading revision history…',
    'success': '',
    'unauthenticated': 'Your session has ended.',
    'not-found': 'This page does not exist.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);

  return { status, revisions, message, load: read.load };
}
