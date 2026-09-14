import type { PageDiff } from './usePageDiff';

export type BookPageDiffStatus = 'idle' | 'loading' | 'success' | 'degraded' | 'not-found' | 'network-error';

interface RevisionListEntry {
  readonly id: string;
  readonly createdAt: string;
}

export interface BookPageHistoryResponse {
  readonly revisions: readonly RevisionListEntry[];
}

export interface BookPageDiffResponse {
  readonly diff: PageDiff;
}

export type BookPageHistoryFetcher = (pageId: string) => Promise<BookPageHistoryResponse>;
export type BookPageDiffFetcher = (pageId: string, from: string, to: string) => Promise<BookPageDiffResponse>;

export interface UseBookPageDiffDeps {
  readonly historyFetcher?: BookPageHistoryFetcher;
  readonly diffFetcher?: BookPageDiffFetcher;
}

export interface UseBookPageDiffResult {
  readonly status: Ref<BookPageDiffStatus>;
  readonly diff: Ref<PageDiff | null>;
  readonly message: Ref<string>;
  readonly load: () => Promise<void>;
}

/**
 * One changed page's full, text-bearing diff for the book-diff screen
 * (block-diff spec: "Book-Level Diff Aggregates Changed Pages Since A
 * Date"; task 10.5). `GET /books/:id/diff?since=` (`useBookDiff`) tells the
 * screen WHICH pages changed but attaches neither block text nor the
 * revision ids `apps/api/src/routes/diff.ts`'s book route used internally
 * — `attachBlockText()` runs only on the page-level route
 * (`apps/api/src/routes/attach-block-text.ts`). This composable closes
 * that gap from the client side using only already-public endpoints:
 *
 * 1. `GET /pages/:id/history` — newest-first (revision-history spec) —
 *    supplies every revision's id and `createdAt` for this page.
 * 2. The revision immediately preceding `since` is found by scanning that
 *    list from the newest end for the first entry whose `createdAt` is at
 *    or before `since` — the exact ordering
 *    `packages/db/src/changesets/book-diff.ts`'s `listChangedPagesSince`
 *    computes server-side with `ORDER BY created_at DESC` per page. The
 *    newest revision overall (`revisions[0]`) is always `to`.
 * 3. `GET /pages/:id/diff?from=&to=` (the same endpoint `usePageDiff`
 *    calls) then returns the real diff, with text.
 *
 * A page whose every revision postdates `since` (created inside the window
 * being viewed) has no baseline at all — `degraded`, a real state per
 * docs/UI-CHECKLIST.md §3, never a crash or a silent gap in the page
 * switcher. The book-diff screen renders it as "this page was created
 * during this window" with a link to the page's own full history.
 */
export function useBookPageDiff(pageId: string, since: string, deps: UseBookPageDiffDeps = {}): UseBookPageDiffResult {
  const historyFetcher: BookPageHistoryFetcher =
    deps.historyFetcher ??
    ((id: string) => {
      const config = useRuntimeConfig();
      return $fetch(`${config.public.apiBaseUrl}/pages/${id}/history`, { credentials: 'include' });
    });
  const diffFetcher: BookPageDiffFetcher =
    deps.diffFetcher ??
    ((id: string, from: string, to: string) => {
      const config = useRuntimeConfig();
      return $fetch(`${config.public.apiBaseUrl}/pages/${id}/diff`, { credentials: 'include', query: { from, to } });
    });

  const status = ref<BookPageDiffStatus>('idle');
  const diff = ref<PageDiff | null>(null);
  const message = ref('');

  /** The revision nearest to, and at or before, `since` — `undefined` when every revision postdates it. Assumes `revisions` is newest-first. */
  function findBaseline(revisions: readonly RevisionListEntry[], sinceIso: string): RevisionListEntry | undefined {
    const sinceMs = new Date(sinceIso).getTime();
    return revisions.find((revision) => new Date(revision.createdAt).getTime() <= sinceMs);
  }

  async function load(): Promise<void> {
    status.value = 'loading';
    diff.value = null;
    message.value = 'Loading page diff…';

    try {
      const history = await historyFetcher(pageId);
      const latest = history.revisions[0];
      if (!latest) {
        status.value = 'degraded';
        message.value = '';
        return;
      }

      const baseline = findBaseline(history.revisions, since);
      if (!baseline) {
        status.value = 'degraded';
        message.value = '';
        return;
      }

      const response = await diffFetcher(pageId, baseline.id, latest.id);
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
