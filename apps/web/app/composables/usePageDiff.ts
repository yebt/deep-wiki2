import { pageDiffKey } from '~/utils/api-keys';

export type PageDiffStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'unauthenticated' | 'network-error';

/** One run of an edited block's text (`InlineSegmentSchema`): shared by both sides, or only the after (`inserted`) or only the before (`deleted`) side. */
export interface InlineSegment {
  readonly kind: 'equal' | 'inserted' | 'deleted';
  readonly text: string;
}

export type BlockChangeWithText =
  | { readonly kind: 'added'; readonly id: string; readonly slot: number; readonly splitFrom?: string; readonly text: string }
  | { readonly kind: 'removed'; readonly id: string; readonly slot: number; readonly mergedInto?: string; readonly text: string }
  | {
      readonly kind: 'modified';
      readonly id: string;
      readonly fromSlot: number;
      readonly toSlot: number;
      readonly moved: boolean;
      readonly text: string;
      /** The word-level changes between the block's two sides; only an edited block has them. */
      readonly segments: readonly InlineSegment[];
    }
  | { readonly kind: 'moved'; readonly id: string; readonly fromSlot: number; readonly toSlot: number; readonly text: string }
  | { readonly kind: 'unchanged'; readonly id: string; readonly slot: number; readonly text: string };

export interface RevisionMeta {
  readonly id: string;
  readonly createdAt: string;
}

export interface PageDiff {
  readonly from: RevisionMeta;
  readonly to: RevisionMeta;
  readonly changes: readonly BlockChangeWithText[];
}

export interface PageDiffResponse {
  readonly diff: PageDiff;
}

export type PageDiffFetcher = (nodeId: string, from: string, to: string) => Promise<PageDiffResponse>;

export interface UsePageDiffResult {
  readonly status: Ref<PageDiffStatus>;
  readonly diff: ComputedRef<PageDiff | null>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the diff already on screen — refresh behind it. */
  readonly load: () => Promise<void>;
}

/**
 * `GET /pages/:id/diff?from=&to=` (block-diff spec). Deliberately a SINGLE
 * `not-found` status for both 403 and 404, the same non-disclosure
 * precedent `usePageHistory` follows: the route itself
 * (`apps/api/src/routes/diff.ts`) already returns a byte-identical 404 for
 * "does not exist" and "exists but you may not read it".
 *
 * "No differences" is not a status of its own — it is `success` with
 * every change classified `unchanged` (block-diff spec's `BlockChange`
 * union always reports one entry per block, on both sides). The caller
 * decides whether that renders as an empty-state notice.
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `pageDiffKey` — the page and both revision ids): server-rendered when
 * the request can be authenticated and both ids are present, and kept
 * for good, since a diff between two named revisions never changes.
 */
export function usePageDiff(nodeId: string, from: string, to: string, fetcher?: PageDiffFetcher): UsePageDiffResult {
  const get =
    fetcher ??
    ((id: string, fromId: string, toId: string) => {
      const api = useApiClient();
      return api<PageDiffResponse>(`/pages/${id}/diff`, { query: { from: fromId, to: toId } });
    });

  const read = useApiRead<PageDiffResponse>(pageDiffKey(nodeId, from, to), () => get(nodeId, from, to), {
    // A URL missing a revision id is settled by the screen as `not-found`
    // without a request; the server must not ask on its behalf.
    server: from.length > 0 && to.length > 0,
  });
  const status = useReadStatus(read, (code) => {
    // Signed out: the screen's next move is sign-in, not a retry
    // (`useSignInRedirect`). Only the browser ever sees it — a 401 during
    // the server's render is "nothing known" (useApiRead).
    if (code === 401) return 'unauthenticated';
    return code === 403 || code === 404 ? 'not-found' : 'network-error';
  });

  const diff = computed(() => (read.outcome.value?.ok ? read.outcome.value.value.diff : null));
  const MESSAGES: Record<PageDiffStatus, string> = {
    'idle': '',
    'loading': 'Loading diff…',
    'success': '',
    'unauthenticated': 'Your session has ended.',
    'not-found': 'This page does not exist.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);

  return { status, diff, message, load: read.load };
}
