export type SavePageStatus = 'idle' | 'saving' | 'success' | 'stale' | 'not-canonical' | 'forbidden' | 'network-error';

export type SavePageFetcher = (nodeId: string, markdown: string, expectedContentHash: string | null) => Promise<{ contentHash: string }>;

export interface UseSavePageResult {
  readonly status: Ref<SavePageStatus>;
  readonly contentHash: Ref<string | null>;
  readonly canonical: Ref<string | null>;
  readonly message: Ref<string>;
  readonly save: (markdown: string, expectedContentHash: string | null) => Promise<void>;
}

/**
 * `PUT /pages/:id` (page-content spec: optimistic concurrency, D16).
 * `stale` (a concurrent save already happened) and `not-canonical` (the
 * document is not its own fixed point, D1) are both 409s but distinct,
 * actionable states — a stale save must reload before retrying, a
 * not-canonical one is offered the canonical text back rather than a
 * bare "conflict" message. Neither ever discards the caller's in-memory
 * buffer; that decision belongs to the page component, not this
 * composable.
 */
export function useSavePage(nodeId: string, fetcher?: SavePageFetcher): UseSavePageResult {
  const config = useRuntimeConfig();
  const put =
    fetcher ??
    ((id: string, markdown: string, expectedContentHash: string | null) =>
      $fetch<{ contentHash: string }>(`${config.public.apiBaseUrl}/pages/${id}`, {
        method: 'PUT',
        credentials: 'include',
        body: { markdown, expectedContentHash },
      }));

  const status = ref<SavePageStatus>('idle');
  const contentHash = ref<string | null>(null);
  const canonical = ref<string | null>(null);
  const message = ref('');

  async function save(markdown: string, expectedContentHash: string | null): Promise<void> {
    status.value = 'saving';
    message.value = 'Saving…';

    try {
      const result = await put(nodeId, markdown, expectedContentHash);
      contentHash.value = result.contentHash;
      canonical.value = null;
      status.value = 'success';
      message.value = 'Saved.';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403) {
        status.value = 'forbidden';
        message.value = "You don't have permission to save this page anymore.";
      } else if (code === 409) {
        const body = responseBodyOf(error) as { error?: string; canonical?: string };
        if (typeof body.canonical === 'string') {
          canonical.value = body.canonical;
          status.value = 'not-canonical';
          message.value = 'This document is not in its canonical form.';
        } else {
          status.value = 'stale';
          message.value = 'Someone else saved a newer version. Reload before saving again.';
        }
      } else {
        status.value = 'network-error';
        message.value = 'Cannot reach the server. Your changes are kept in this tab — try saving again.';
      }
    }
  }

  return { status, contentHash, canonical, message, save };
}
