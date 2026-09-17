import { describe, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import type { WorkspaceActivityResponse } from '@deep-wiki/contracts';
import { usePageMentions } from './usePageMentions';

function activity(threads: Partial<WorkspaceActivityResponse['threads'][number]>[]): WorkspaceActivityResponse {
  return {
    workspace: { id: 'ws-1', name: 'Acme', slug: 'acme' },
    recent: [],
    mine: [],
    threads: threads.map((thread, index) => ({
      id: `t${index}`,
      pageId: 'page-1',
      pageTitle: 'A Page',
      quote: 'q',
      orphaned: false,
      author: { id: 'u1', displayName: 'Ana' },
      replyCount: 0,
      lastActivityAt: '2026-09-15T10:00:00.000Z',
      mentionsYou: false,
      awaitsYou: false,
      ...thread,
    })),
  };
}

/**
 * The count on the comments toggle while comments are hidden: open
 * threads on *this* page that write the caller's name. The client cannot
 * compute it from `GET /pages/:id/comments` — it does not know who the
 * caller is — so it is read off the workspace activity the dashboard
 * already uses, which carries `mentionsYou` per open thread, and filtered
 * to this page. Asked for only while hidden and only when the page has
 * threads, so a read-only caller and a page with nothing to hide never
 * make the request.
 */
describe('usePageMentions', () => {
  test('counts open threads on this page that mention the caller, and no others', async () => {
    const fetcher = vi.fn(async () =>
      activity([
        { mentionsYou: true },
        { mentionsYou: true, pageId: 'another-page' },
        { mentionsYou: false, awaitsYou: true },
        { mentionsYou: true },
      ]),
    );
    const mentions = usePageMentions('page-1', ref('ws-1'), fetcher);
    expect(mentions.count.value).toBe(0);

    await mentions.load();

    expect(fetcher).toHaveBeenCalledWith('ws-1');
    expect(mentions.count.value).toBe(2);
    expect(mentions.status.value).toBe('success');
  });

  test('does nothing without a workspace to ask, and a failed request leaves the count at zero rather than inventing one', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('offline');
    });
    const withoutWorkspace = usePageMentions('page-1', ref(null), fetcher);
    await withoutWorkspace.load();
    expect(fetcher).not.toHaveBeenCalled();
    expect(withoutWorkspace.status.value).toBe('idle');

    const failing = usePageMentions('page-1', ref('ws-1'), fetcher);
    await failing.load();
    expect(failing.count.value).toBe(0);
    expect(failing.status.value).toBe('failed');
  });
});
