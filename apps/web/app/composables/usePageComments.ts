import type { CommentIndicator, CommentThread, CreateCommentRequest, CreateCommentResponse, PageCommentsResponse } from '@deep-wiki/contracts';
import type { NewThreadRequest } from './useNewThread';

export type PageCommentsStatus = 'idle' | 'loading' | 'success' | 'hidden' | 'network-error';

export type PageCommentsFetcher = (pageId: string) => Promise<PageCommentsResponse>;
export type CommentReplyFetcher = (pageId: string, body: { parentId: string; body: string }) => Promise<{ id: string }>;
export type ThreadResolveFetcher = (threadId: string, body: { resolved: boolean }) => Promise<{ ok: boolean }>;
export type CommentCreateFetcher = (pageId: string, body: CreateCommentRequest) => Promise<CreateCommentResponse>;

export type CreateOutcome = { readonly ok: true; readonly blockId: string } | { readonly ok: false };

export interface UsePageCommentsDeps {
  readonly fetcher?: PageCommentsFetcher;
  readonly replyFetcher?: CommentReplyFetcher;
  readonly resolveFetcher?: ThreadResolveFetcher;
  readonly createFetcher?: CommentCreateFetcher;
  /** The server minted a persisted anchor for the derived id a new thread named — told before the reload, so the screen can name the block the new way. */
  readonly onAnchorMinted?: (derivedBlockId: string, persistedBlockId: string) => void;
}

export interface UsePageCommentsResult {
  readonly status: Ref<PageCommentsStatus>;
  readonly threads: Ref<readonly CommentThread[]>;
  /** The caller's own grant, from the response — `false` until it says otherwise. The screen offers no way to start a thread before then. */
  readonly canComment: Ref<boolean>;
  /** Threads posted and not yet confirmed by the server — shown, counted, and not yet repliable. */
  readonly pendingThreadIds: ComputedRef<readonly string[]>;
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
  /** Starts a thread, optimistically: see the note on `create` below. */
  readonly create: (input: NewThreadRequest) => Promise<CreateOutcome>;
}

const PENDING_PREFIX = 'pending:';

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
  const createFetcher: CommentCreateFetcher =
    deps.createFetcher ??
    ((id, body) => {
      const config = useRuntimeConfig();
      return $fetch<CreateCommentResponse>(`${config.public.apiBaseUrl}/pages/${id}/comments`, { method: 'POST', credentials: 'include', body });
    });

  const status = ref<PageCommentsStatus>('idle');
  const threads = ref<readonly CommentThread[]>([]);
  const canComment = ref(false);
  const message = ref('');
  const writeMessage = ref<string | null>(null);
  let pendingSequence = 0;

  const pendingThreadIds = computed(() => threads.value.filter((thread) => thread.id.startsWith(PENDING_PREFIX)).map((thread) => thread.id));

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
      canComment.value = response.canComment;
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

  /**
   * Starting a thread, optimistically (docs/UI-CHECKLIST.md §3, "Success"
   * confirmed visibly; §4.7, the mark appears beside the block): a
   * provisional thread goes into the list the moment it is posted — the
   * gutter counts it, the panel shows it marked pending — and the server's
   * own list replaces it on success, exactly as a reply's reload does.
   *
   * The block the thread names may be a derived id (`data-derived-block-id`,
   * `utils/block-element.ts`), which the server turns into a persisted
   * anchor as part of the same request and re-renders the page around. The
   * DOM this screen holds still names the block the old way, so before the
   * reload — whose thread will carry the *new* id — `onAnchorMinted` lets
   * the screen adopt it; otherwise the thread just posted would come back
   * as "not placed yet" until a reload.
   *
   * On failure the provisional thread is withdrawn and the message says
   * what survived: the composer keeps the text (§3, "Error — fatal …
   * preserves any unsaved user input and says explicitly whether the work
   * was lost or preserved"). A 409 is the one failure that is not a
   * retry: the page changed under the reader, and the honest next step is
   * a reload.
   */
  async function create(input: NewThreadRequest): Promise<CreateOutcome> {
    writeMessage.value = null;
    const provisional: CommentThread = {
      id: `${PENDING_PREFIX}${++pendingSequence}`,
      body: input.body,
      author: { id: null, displayName: 'You' },
      createdAt: new Date().toISOString(),
      anchor: { blockId: input.blockId, offsetStart: 0, offsetEnd: input.excerpt.length, quote: input.excerpt, orphaned: false },
      resolved: false,
      resolvedAt: null,
      replies: [],
    };
    threads.value = [...threads.value, provisional];

    let response: CreateCommentResponse;
    try {
      response = await createFetcher(pageId, {
        blockId: input.blockId,
        ...(input.quote === null ? {} : { quote: input.quote }),
        body: input.body,
        mentionedUserIds: [...input.mentionedUserIds],
      });
    } catch (error) {
      threads.value = threads.value.filter((thread) => thread.id !== provisional.id);
      writeMessage.value =
        httpStatusOf(error) === 409
          ? 'This block has changed since you opened the page. Your text is still here — reload the page to comment on its current text.'
          : `${describeWriteFailure(error, 'post this comment')} Your text is still here.`;
      return { ok: false };
    }

    const blockId = response.blockId ?? input.blockId;
    if (blockId !== input.blockId) deps.onAnchorMinted?.(input.blockId, blockId);
    await load();
    return { ok: true, blockId };
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

  return { status, threads, canComment, pendingThreadIds, indicators, orphaned, message, writeMessage, load, reply, setResolved, create };
}
