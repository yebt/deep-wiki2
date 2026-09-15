import { describe, expect, test, vi } from 'vitest';
import { useEditSession } from './useEditSession';

/** Shape of the error `$fetch`/ofetch throws when the server responded with a non-2xx status: `.response.status` plus the parsed body on `.data`. */
function responseError(status: number, body: unknown) {
  return { response: { status }, data: body };
}

describe('useEditSession', () => {
  test('starts idle and moves to ready with the markdown, title, content hash and lock', async () => {
    const fetcher = vi.fn(async () => ({
      markdown: '# Hi\n',
      title: 'Hi',
      workspaceId: 'ws-1',
      contentHash: 'server-hash',
      lock: { holderUserId: 'me', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:00:00Z' },
    }));
    const { status, session, load } = useEditSession('page-1', fetcher);

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('ready');
    expect(session.value?.markdown).toBe('# Hi\n');
    expect(session.value?.workspaceId).toBe('ws-1');
    // page-content spec, D16: the first Save on an existing page has no
    // other source for this — it is the field docs/TODO.md's Finding names.
    expect(session.value?.contentHash).toBe('server-hash');
  });

  test('a 409 with reason "locked" moves to the locked state with the holder', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, {
        reason: 'locked',
        holder: { userId: 'other', acquiredAt: '2026-01-01T00:00:00Z', heartbeatAt: '2026-01-01T00:05:00Z' },
        offeredExits: ['read_only', 'take_over'],
      });
    });
    const { status, refusal, load } = useEditSession('page-1', fetcher);

    await load();

    expect(status.value).toBe('locked');
    expect(refusal.value?.holder?.userId).toBe('other');
    expect(refusal.value?.offeredExits).toContain('take_over');
  });

  test('a 409 with an unsupported-construct reason moves to the refused state naming the construct and line', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, {
        reason: 'unsupported_construct',
        construct: 'setext heading',
        line: 3,
        offeredExits: ['read_only', 'normalise'],
      });
    });
    const { status, refusal, load } = useEditSession('page-1', fetcher);

    await load();

    expect(status.value).toBe('refused');
    expect(refusal.value?.construct).toBe('setext heading');
    expect(refusal.value?.line).toBe(3);
  });

  test('403 and 404 map to distinct, coherent states', async () => {
    const forbidden = useEditSession(
      'page-1',
      vi.fn(async () => {
        throw responseError(403, { error: 'forbidden' });
      }),
    );
    await forbidden.load();
    expect(forbidden.status.value).toBe('forbidden');

    const notFound = useEditSession(
      'page-1',
      vi.fn(async () => {
        throw responseError(404, { error: 'not found' });
      }),
    );
    await notFound.load();
    expect(notFound.status.value).toBe('not-found');
  });

  test('takeOver() moves from locked to ready using the take-over response', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, { reason: 'locked', holder: { userId: 'other', acquiredAt: 'x', heartbeatAt: 'y' }, offeredExits: ['read_only', 'take_over'] });
    });
    const takeOverFetcher = vi.fn(async () => ({
      markdown: '# Hi\n',
      title: 'Hi',
      workspaceId: 'ws-1',
      contentHash: 'server-hash',
      lock: { holderUserId: 'me', acquiredAt: 'z', heartbeatAt: 'z' },
    }));
    const { status, load, takeOver } = useEditSession('page-1', fetcher, takeOverFetcher);

    await load();
    expect(status.value).toBe('locked');

    await takeOver();
    expect(status.value).toBe('ready');
    expect(takeOverFetcher).toHaveBeenCalledWith('page-1');
  });
});

/**
 * ── The trap this bug hides behind ─────────────────────────────────────
 *
 * `responseError(500, {})` above does NOT reproduce the defect, and
 * neither does a plain `new Error('fetch failed')`: both classify
 * correctly even against the broken guard. It only appears with ofetch's
 * real shape — `response` present as an own key and set to `undefined`,
 * because no response ever arrived — which makes `'response' in error`
 * true and lets `error.response.status` throw *inside `applyFailure`*,
 * before any status is assigned.
 *
 * Both entry points into `applyFailure` are covered: a status stuck on
 * `loading` is the editor's blank screen, whichever call produced it.
 */
function unreachableApi(): Error & { readonly response: undefined } {
  return Object.assign(new Error('fetch failed'), { response: undefined });
}

describe('useEditSession when the API never responded', () => {
  test('the fixture carries ofetch real shape, not a convenient mock', () => {
    const error = unreachableApi();

    expect('response' in error).toBe(true);
    expect(error.response).toBeUndefined();
  });

  test('load() settles into network-error instead of hanging on the loading skeleton', async () => {
    const { status, message, load } = useEditSession(
      'page-1',
      vi.fn(async () => {
        throw unreachableApi();
      }),
    );

    const settled = await load().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    expect(status.value).not.toBe('loading');
    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
    expect(settled).toBe('resolved');
  });

  test('takeOver() settles into network-error rather than leaving the editor loading', async () => {
    const { status, takeOver } = useEditSession(
      'page-1',
      vi.fn(async () => {
        throw unreachableApi();
      }),
      vi.fn(async () => {
        throw unreachableApi();
      }),
    );

    const settled = await takeOver().then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    expect(status.value).not.toBe('loading');
    expect(status.value).toBe('network-error');
    expect(settled).toBe('resolved');
  });
});
