export type PageDiffStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'network-error';

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
  readonly diff: Ref<PageDiff | null>;
  readonly message: Ref<string>;
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
 */
export function usePageDiff(nodeId: string, from: string, to: string, fetcher?: PageDiffFetcher): UsePageDiffResult {
  const get =
    fetcher ??
    ((id: string, fromId: string, toId: string) => {
      const config = useRuntimeConfig();
      return $fetch<PageDiffResponse>(`${config.public.apiBaseUrl}/pages/${id}/diff`, {
        credentials: 'include',
        query: { from: fromId, to: toId },
      });
    });

  const status = ref<PageDiffStatus>('idle');
  const diff = ref<PageDiff | null>(null);
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading diff…';

    try {
      const response = await get(nodeId, from, to);
      diff.value = response.diff;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403 || code === 404) {
        status.value = 'not-found';
        message.value = 'This page does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, diff, message, load };
}
