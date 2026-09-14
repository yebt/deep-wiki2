import { describe, expect, test, vi } from 'vitest';
import type { CommentThread } from '@deep-wiki/contracts';
import { usePageComments } from './usePageComments';

function thread(overrides: Partial<CommentThread> & { id: string; blockId?: string; orphaned?: boolean }): CommentThread {
  const { blockId = 'b1', orphaned = false, ...rest } = overrides;
  return {
    body: 'Root',
    author: { id: 'u1', displayName: 'Ana' },
    createdAt: '2026-01-01T00:00:00.000Z',
    anchor: { blockId, offsetStart: 0, offsetEnd: 4, quote: 'Root', orphaned },
    resolved: false,
    resolvedAt: null,
    replies: [],
    ...rest,
  };
}

describe('usePageComments', () => {
  test('loads the threads once and moves idle → loading → success', async () => {
    const fetcher = vi.fn(async () => ({ threads: [thread({ id: 't1' })] }));
    const { status, threads, load } = usePageComments('page-1', { fetcher });

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(threads.value.map((t) => t.id)).toEqual(['t1']);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('page-1');
  });

  // comment-overlay spec: the indicator a gutter draws is one mark per
  // block with a reply-inclusive count — several threads on one block
  // collapse into one mark (docs/UI-CHECKLIST.md §4.7). An orphaned thread
  // has no block to indicate against, so it contributes nothing here and
  // is surfaced by `orphaned` instead.
  test('derives one indicator per anchored block, counting replies, and never from an orphaned thread', async () => {
    const fetcher = vi.fn(async () => ({
      threads: [
        thread({ id: 't1', blockId: 'b1', replies: [{ id: 'r1', body: 'x', author: { id: 'u2', displayName: 'Ben' }, createdAt: '2026-01-01T00:01:00.000Z' }] }),
        thread({ id: 't2', blockId: 'b1' }),
        thread({ id: 't3', blockId: 'b2' }),
        thread({ id: 't4', blockId: 'b3', orphaned: true }),
      ],
    }));
    const { indicators, orphaned, load } = usePageComments('page-1', { fetcher });
    await load();

    expect(indicators.value).toEqual([
      { blockId: 'b1', count: 3 },
      { blockId: 'b2', count: 1 },
    ]);
    expect(orphaned.value.map((t) => t.id)).toEqual(['t4']);
  });

  // The API deliberately answers `{ threads: [] }` for a subject with read
  // but not comment, byte-identical to zero comments. The client must not
  // draw an empty gutter for either.
  test('an empty response leaves nothing to draw: no indicators, no orphans', async () => {
    const fetcher = vi.fn(async () => ({ threads: [] }));
    const { indicators, orphaned, load } = usePageComments('page-1', { fetcher });
    await load();

    expect(indicators.value).toEqual([]);
    expect(orphaned.value).toEqual([]);
  });

  // A 403/404 here means the page itself already told the user what
  // happened; the overlay has nothing to add and must not render a second
  // notice about the same page.
  test('a 403 or 404 collapses to the hidden state, not an error the screen would announce', async () => {
    for (const code of [403, 404]) {
      const fetcher = vi.fn(async () => {
        throw { response: { status: code } };
      });
      const { status, load } = usePageComments('page-1', { fetcher });
      await load();
      expect(status.value, String(code)).toBe('hidden');
    }
  });

  test('a network failure is the recoverable error state, with a message in the user’s terms', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageComments('page-1', { fetcher });
    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/comments/i);
    expect(message.value).not.toMatch(/fetch failed/);
  });

  test('a reply posts to the thread and reloads the threads so the panel shows the server’s truth', async () => {
    const fetcher = vi.fn(async () => ({ threads: [thread({ id: 't1' })] }));
    const replyFetcher = vi.fn(async () => ({ id: 'r1' }));
    const { reply, load } = usePageComments('page-1', { fetcher, replyFetcher });
    await load();

    const ok = await reply('t1', 'Agreed.');

    expect(ok).toBe(true);
    expect(replyFetcher).toHaveBeenCalledWith('page-1', { parentId: 't1', body: 'Agreed.' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('resolving a thread patches its state and reloads', async () => {
    const fetcher = vi.fn(async () => ({ threads: [thread({ id: 't1' })] }));
    const resolveFetcher = vi.fn(async () => ({ ok: true }));
    const { setResolved, load } = usePageComments('page-1', { fetcher, resolveFetcher });
    await load();

    const ok = await setResolved('t1', true);

    expect(ok).toBe(true);
    expect(resolveFetcher).toHaveBeenCalledWith('t1', { resolved: true });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test('a failed write reports false and a message, and leaves the loaded threads in place', async () => {
    const fetcher = vi.fn(async () => ({ threads: [thread({ id: 't1' })] }));
    const replyFetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { reply, threads, writeMessage, load } = usePageComments('page-1', { fetcher, replyFetcher });
    await load();

    const ok = await reply('t1', 'Agreed.');

    expect(ok).toBe(false);
    expect(writeMessage.value).toMatch(/couldn't post|reach the server/i);
    expect(threads.value).toHaveLength(1);
  });

  test('a forbidden write says so in the user’s terms rather than as a status code', async () => {
    const fetcher = vi.fn(async () => ({ threads: [thread({ id: 't1' })] }));
    const resolveFetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { setResolved, writeMessage, load } = usePageComments('page-1', { fetcher, resolveFetcher });
    await load();

    await setResolved('t1', true);

    expect(writeMessage.value).toMatch(/permission/i);
    expect(writeMessage.value).not.toMatch(/403/);
  });
});
