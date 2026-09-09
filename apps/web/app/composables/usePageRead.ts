export type PageReadStatus = 'idle' | 'loading' | 'success' | 'not-found' | 'forbidden' | 'network-error';

export interface PageReadResponse {
  readonly html: string;
  readonly title: string;
}

export type PageReadFetcher = (nodeId: string) => Promise<PageReadResponse>;

/** Shape of the error ofetch/`$fetch` throws when the server responded (with a non-2xx status). */
interface ResponseError {
  readonly response: { readonly status?: number };
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === 'object' && error !== null && 'response' in error) {
    return (error as ResponseError).response?.status;
  }
  return undefined;
}

export interface UsePageReadResult {
  readonly status: Ref<PageReadStatus>;
  readonly html: Ref<string>;
  readonly title: Ref<string>;
  readonly message: Ref<string>;
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
 */
export function usePageRead(nodeId: string, fetcher?: PageReadFetcher): UsePageReadResult {
  const get =
    fetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch<PageReadResponse>(`${config.public.apiBaseUrl}/pages/${id}`, { credentials: 'include' });
    });

  const status = ref<PageReadStatus>('idle');
  const html = ref('');
  const title = ref('');
  const message = ref('');

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading page…';

    try {
      const response = await get(nodeId);
      html.value = response.html;
      title.value = response.title;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = statusOf(error);
      if (code === 403) {
        status.value = 'forbidden';
        message.value = "You don't have access to this page.";
      } else if (code === 404) {
        status.value = 'not-found';
        message.value = 'This page does not exist.';
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Check your connection and try again.';
      }
    }
  }

  return { status, html, title, message, load };
}
