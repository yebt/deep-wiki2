import type { WorkspaceActivityResponse } from '@deep-wiki/contracts';
import type { WorkspaceActivityFetcher } from './useWorkspaceActivity';

export type PageMentionsStatus = 'idle' | 'loading' | 'success' | 'failed';

export interface UsePageMentionsResult {
  /** Open threads on this page in which someone writes the caller's name. */
  readonly count: Ref<number>;
  readonly status: Ref<PageMentionsStatus>;
  readonly load: () => Promise<void>;
}

/**
 * The number on the comments toggle while comments are hidden: the open
 * threads on this page that mention the caller, so that "hidden" never
 * means "unaware" (docs/UI-CHECKLIST.md §3's honesty, applied to a
 * preference).
 *
 * The client cannot compute this from `GET /pages/:id/comments`: a
 * mention is `@<display name>` in a body, and nothing the client holds
 * says who the caller is. `GET /workspaces/:id/activity` already answers
 * it per open thread (`mentionsYou`, the dashboard's "Names you"), so the
 * count is that response filtered to this page. It is asked for only
 * while comments are hidden and only when the page has threads — so a
 * read-only caller, who has none, and a page with nothing to hide never
 * pay the request. Two limits, stated: the activity list is capped
 * server-side at twenty threads across the workspace, so on a very busy
 * workspace the count can under-report; and a failed request leaves the
 * count at zero rather than inventing one.
 */
export function usePageMentions(
  pageId: string,
  workspaceId: MaybeRefOrGetter<string | null>,
  fetcher?: WorkspaceActivityFetcher,
): UsePageMentionsResult {
  // The config is read here, in setup, because `load` runs from a watcher
  // later, where no Nuxt context is guaranteed to be current.
  const apiBaseUrl = fetcher ? null : useRuntimeConfig().public.apiBaseUrl;
  const get: WorkspaceActivityFetcher =
    fetcher ?? ((id: string) => $fetch<WorkspaceActivityResponse>(`${apiBaseUrl}/workspaces/${id}/activity`, { credentials: 'include' }));

  const count = ref(0);
  const status = ref<PageMentionsStatus>('idle');

  async function load(): Promise<void> {
    const id = toValue(workspaceId);
    if (!id) return;
    status.value = 'loading';
    try {
      const response = await get(id);
      count.value = response.threads.filter((thread) => thread.pageId === pageId && thread.mentionsYou).length;
      status.value = 'success';
    } catch {
      count.value = 0;
      status.value = 'failed';
    }
  }

  return { count, status, load };
}
