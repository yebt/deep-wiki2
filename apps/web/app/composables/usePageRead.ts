import type { NodeWorkspace } from '@deep-wiki/contracts';
import { pageReadKey } from '~/utils/api-keys';
import type { NodeLocation } from './useNodeLocation';
import { nodeLocationOf } from './useNodeLocation';

export type PageReadStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'forbidden' | 'unauthenticated' | 'network-error';

export interface PageReadResponse {
  readonly html: string;
  readonly title: string;
  /** The workspace the page belongs to — what the read screen opens the workspace-scoped presence stream with (editing-presence spec). */
  readonly workspaceId: string;
  /** The same workspace with the slug the address carries (`NodeWorkspaceSchema`). */
  readonly workspace: NodeWorkspace;
}

export type PageReadFetcher = (nodeId: string) => Promise<PageReadResponse>;

export interface UsePageReadResult {
  readonly status: Ref<PageReadStatus>;
  readonly html: ComputedRef<string>;
  readonly title: ComputedRef<string>;
  /** `null` until a successful response names it. */
  readonly workspaceId: ComputedRef<string | null>;
  /** Where the page lives, as this read says (`NodeLocation`) — what the shell holds the address to its word with, in place of a second request. */
  readonly location: ComputedRef<NodeLocation>;
  readonly message: ComputedRef<string>;
  /** Fetch, or — with the page already on screen — refresh behind it. */
  readonly load: () => Promise<void>;
}

/**
 * `GET /pages/:id` (page-content spec: "Read mode request returns cached
 * HTML"; document-modes: "Read Mode Serves Pre-Rendered HTML Without
 * Reparsing"). This composable never imports `@deep-wiki/editor` or any
 * ProseMirror/Milkdown module — read mode's whole point is that it never
 * boots the editor, and `scripts/checks/bundle-isolation.ts`'s
 * build-output layer proves it over the actual read-route bundle
 * (docs/UI-CHECKLIST.md §4.5).
 *
 * `403` and `404` are distinguished rather than both collapsed into a
 * generic error: the API tells them apart (a page that does not exist vs.
 * one that exists but is denied), and checklist §3 requires a coherent,
 * distinct permission-denied state rather than folding it into "recoverable
 * error". This is a different, deliberate answer from the non-disclosure
 * rule for a *wiki-link inside content* (design.md D18: an unreadable
 * target renders identically to a nonexistent one) — that rule protects
 * against leaking a title through link text a viewer never asked to
 * navigate to; a subject who directly requests a page URL and is denied
 * is told so, consistent with how `pages.ts` itself already returns a
 * distinct 403 for this exact route.
 *
 * The answer lives in the read layer (`useApiRead`, keyed by
 * `pageReadKey`): server-rendered into the document when the request can
 * be authenticated, kept across screens so coming back to a page renders
 * it from memory and refreshes behind the article, and cleared by
 * `useSavePage` when this page is saved. A failed answer is never kept
 * (useApiRead's rule), so a denied page and an absent one are asked again
 * identically on the next visit — the cache cannot tell them apart either.
 */
export function usePageRead(nodeId: string, fetcher?: PageReadFetcher): UsePageReadResult {
  const get =
    fetcher ??
    ((id: string) => {
      const api = useApiClient();
      return api<PageReadResponse>(`/pages/${id}`);
    });

  const read = useApiRead<PageReadResponse>(pageReadKey(nodeId), () => get(nodeId));

  const status = useReadStatus(read, (code) => {
    // Signed out: the screen's next move is sign-in, not a retry
    // (`useSignInRedirect`), so this is never the network branch. Only the
    // browser ever sees it — a 401 during the server's render is "nothing
    // known" (useApiRead), and the browser asks again with its own cookie.
    if (code === 401) return 'unauthenticated';
    if (code === 403) return 'forbidden';
    if (code === 404) return 'not-found';
    return 'network-error';
  });

  const value = computed(() => (read.outcome.value?.ok ? read.outcome.value.value : null));
  const html = computed(() => value.value?.html ?? '');
  const title = computed(() => value.value?.title ?? '');
  const workspaceId = computed(() => value.value?.workspaceId ?? null);
  const location = computed(() => nodeLocationOf(status.value, value.value?.workspace));

  const MESSAGES: Record<PageReadStatus, string> = {
    'idle': '',
    'loading': 'Loading page…',
    'success': '',
    'forbidden': "You don't have access to this page.",
    'not-found': 'This page does not exist.',
    'unauthenticated': 'Your session has ended.',
    'network-error': 'Cannot reach the server. Check your connection and try again.',
  };
  const message = computed(() => MESSAGES[status.value]);

  return { status, html, title, workspaceId, location, message, load: read.load };
}
