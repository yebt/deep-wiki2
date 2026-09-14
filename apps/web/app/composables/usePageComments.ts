import type { CommentIndicator, CommentThread, PageCommentsResponse } from '@deep-wiki/contracts';

export type PageCommentsStatus = 'idle' | 'loading' | 'success' | 'hidden' | 'network-error';

export type PageCommentsFetcher = (pageId: string) => Promise<PageCommentsResponse>;
export type CommentReplyFetcher = (pageId: string, body: { parentId: string; body: string }) => Promise<{ id: string }>;
export type ThreadResolveFetcher = (threadId: string, body: { resolved: boolean }) => Promise<{ ok: boolean }>;

export interface UsePageCommentsDeps {
  readonly fetcher?: PageCommentsFetcher;
  readonly replyFetcher?: CommentReplyFetcher;
  readonly resolveFetcher?: ThreadResolveFetcher;
}

export interface UsePageCommentsResult {
  readonly status: Ref<PageCommentsStatus>;
  readonly threads: Ref<readonly CommentThread[]>;
  /** One mark per anchored block, reply-inclusive count — what the gutter draws (docs/UI-CHECKLIST.md §4.7: several threads on one block collapse into one mark). */
  readonly indicators: ComputedRef<readonly CommentIndicator[]>;
  /** Threads whose block is gone (comment-threads spec: "Orphan Is A First-Class State"). */
  readonly orphaned: ComputedRef<readonly CommentThread[]>;
  readonly message: Ref<string>;
  /** The last failed write's message, in the user's terms; `null` while nothing has failed. */
  readonly writeMessage: Ref<string | null>;
  readonly load: () => Promise<void>;
  readonly reply: (threadId: string, body: string) => Promise<boolean>;
  readonly setResolved: (threadId: string, resolved: boolean) => Promise<boolean>;
}

/**
 * The comment overlay's one read (comment-overlay spec: "The Client
 * Composes Indicators Onto Unchanged Cached HTML"), plus the two writes the
 * thread panel makes (comment-threads spec: "Threads And Resolution
 * State").
 *
 * **One request, `GET /pages/:id/comments`, not the indicators endpoint
 * first and threads later.** Deliberate, and measured against the read
 * screen's traffic share (docs/SPECS.md §5.3, ~95% of page views):
 *
 * - `GET /pages/:id/comments/indicators` counts only `status = 'anchored'`
 *   roots (`packages/db/src/comments/queries.ts`). An orphaned thread is
 *   invisible to it by construction, so a client that drew its gutter
 *   from indicators and fetched threads only when a mark was clicked would
 *   never learn that a page's only threads are orphans — the exact
 *   "silently vanished thread" docs/UI-CHECKLIST.md §4.7 forbids. The
 *   threads response is the only one that carries `anchor.orphaned`.
 * - For a subject with `read` but not `comment` — the common case — both
 *   endpoints answer the same 14-byte body (`{"threads":[]}` here), so
 *   the read path pays one small request either way; this way it pays
 *   one instead of two.
 * - For a subject who can comment, the body carries every thread's text
 *   up front. That is the same payload the panel needs the moment a mark
 *   is clicked, so opening a thread costs no further request, and a reply
 *   or a resolve costs exactly one write plus one re-read.
 *
 * Indicators are derived here rather than fetched: one mark per anchored
 * block, its count `1 + replies` summed across every thread on that
 * block, matching `listCommentIndicators` line for line so the two never
 * disagree about what a mark means.
 *
 * 403/404 collapse into `hidden`: the page request already told the user
 * what happened to this page, and the overlay has nothing to add — a
 * second notice about the same page would be noise (§3, one screen per
 * failure). A network failure is its own recoverable state because the
 * page may have loaded fine while this request did not.
 */
export function usePageComments(pageId: string, deps: UsePageCommentsDeps = {}): UsePageCommentsResult {
  const fetcher: PageCommentsFetcher =
    deps.fetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch<PageCommentsResponse>(`${config.public.apiBaseUrl}/pages/${id}/comments`, { credentials: 'include' });
    });
  const replyFetcher: CommentReplyFetcher =
    deps.replyFetcher ??
    ((id, body) => {
      const config = useRuntimeConfig();
      return $fetch<{ id: string }>(`${config.public.apiBaseUrl}/pages/${id}/comments`, { method: 'POST', credentials: 'include', body });
    });
  const resolveFetcher: ThreadResolveFetcher =
    deps.resolveFetcher ??
    ((threadId, body) => {
      const config = useRuntimeConfig();
      return $fetch<{ ok: boolean }>(`${config.public.apiBaseUrl}/comments/${threadId}/resolved`, { method: 'PATCH', credentials: 'include', body });
    });

  const status = ref<PageCommentsStatus>('idle');
  const threads = ref<readonly CommentThread[]>([]);
  const message = ref('');
  const writeMessage = ref<string | null>(null);

  const indicators = computed<readonly CommentIndicator[]>(() => {
    const byBlock = new Map<string, number>();
    for (const thread of threads.value) {
      if (thread.anchor.orphaned) continue;
      byBlock.set(thread.anchor.blockId, (byBlock.get(thread.anchor.blockId) ?? 0) + 1 + thread.replies.length);
    }
    return [...byBlock.entries()].map(([blockId, count]) => ({ blockId, count }));
  });

  const orphaned = computed<readonly CommentThread[]>(() => threads.value.filter((thread) => thread.anchor.orphaned));

  async function load(): Promise<void> {
    status.value = 'loading';
    message.value = 'Loading comments…';

    try {
      const response = await fetcher(pageId);
      threads.value = response.threads;
      status.value = 'success';
      message.value = '';
    } catch (error) {
      const code = httpStatusOf(error);
      if (code === 403 || code === 404) {
        status.value = 'hidden';
        message.value = '';
      } else {
        status.value = 'network-error';
        message.value = "Couldn't load this page's comments. Check your connection and try again.";
      }
    }
  }

  function describeWriteFailure(error: unknown, verb: string): string {
    const code = httpStatusOf(error);
    if (code === 403) return `You don't have permission to ${verb} here. Ask a workspace admin for comment access.`;
    if (code === 404) return 'This thread is no longer here. Reload the page to see what changed.';
    return `Couldn't ${verb}. Check your connection and try again.`;
  }

  async function reply(threadId: string, body: string): Promise<boolean> {
    writeMessage.value = null;
    try {
      await replyFetcher(pageId, { parentId: threadId, body });
    } catch (error) {
      writeMessage.value = describeWriteFailure(error, 'post this reply');
      return false;
    }
    await load();
    return true;
  }

  async function setResolved(threadId: string, resolved: boolean): Promise<boolean> {
    writeMessage.value = null;
    try {
      await resolveFetcher(threadId, { resolved });
    } catch (error) {
      writeMessage.value = describeWriteFailure(error, resolved ? 'resolve this thread' : 'reopen this thread');
      return false;
    }
    await load();
    return true;
  }

  return { status, threads, indicators, orphaned, message, writeMessage, load, reply, setResolved };
}
