export type PageHistoryStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

export interface RevisionSummary {
  readonly id: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: string;
  readonly changesetId: string | null;
}

export interface PageHistoryResponse {
  readonly revisions: readonly RevisionSummary[];
}

export type PageHistoryFetcher = (nodeId: string) => Promise<PageHistoryResponse>;

export interface UsePageHistoryResult {
  readonly status: Ref<PageHistoryStatus>;
  readonly revisions: Ref<readonly RevisionSummary[]>;
  readonly message: Ref<string>;
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
 */
export function usePageHistory(nodeId: string, fetcher?: PageHistoryFetcher): UsePageHistoryResult {
  const get =
    fetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch<PageHistoryResponse>(`${config.public.apiBaseUrl}/pages/${id}/history`, { credentials: 'include' });
    });

  const status = ref<PageHistoryStatus>('idle');
  const revisions = ref<readonly RevisionSummary[]>([]);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading revision history…';

    try {
      const response = await get(nodeId);
      revisions.value = response.revisions;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      // Signed out: the screen's next move is sign-in, not a retry
      // (`useSignInRedirect`), so this is never the network branch.
      if (code === 401) {
        status.value = 'unauthenticated';
        message.value = 'Your session has ended.';
        return;
      }
      if (code === 403 || code === 404) {
        status.value = 'not-found';
        message.value = 'This page does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, revisions, message, load };
}
