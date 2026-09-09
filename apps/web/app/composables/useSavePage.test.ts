import { describe, expect, test, vi } from 'vitest';
import { useSavePage } from './useSavePage';

function responseError(status: number, body: unknown = {}) {
  return { response: { status }, data: body };
}

describe('useSavePage', () => {
  test('starts idle and moves to success with the new content hash', async () => {
    const fetcher = vi.fn(async () => ({ contentHash: 'hash-2' }));
    const { status, contentHash, save } = useSavePage('page-1', fetcher);

    expect(status.value).toBe('idle');
    await save('# Hi\n', 'hash-1');

    expect(status.value).toBe('success');
    expect(contentHash.value).toBe('hash-2');
    expect(fetcher).toHaveBeenCalledWith('page-1', '# Hi\n', 'hash-1');
  });

  test('a 409 stale response preserves the buffer and reports the stale state', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, { error: 'stale content: reload before saving again' });
    });
    const { status, save } = useSavePage('page-1', fetcher);

    await save('# Hi\n', 'stale-hash');

    expect(status.value).toBe('stale');
  });

  test('a 409 not-canonical response reports the canonical form offered back', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, { error: 'not canonical', canonical: '# Hi\n\n' });
    });
    const { status, canonical, save } = useSavePage('page-1', fetcher);

    await save('# Hi', 'hash-1');

    expect(status.value).toBe('not-canonical');
    expect(canonical.value).toBe('# Hi\n\n');
  });

  test('403 maps to forbidden', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(403);
    });
    const { status, save } = useSavePage('page-1', fetcher);

    await save('# Hi\n', null);

    expect(status.value).toBe('forbidden');
  });
});

/**
 * ── The trap this bug hides behind ─────────────────────────────────────
 *
 * `responseError(500)` above does NOT reproduce the defect, and neither
 * does a plain `new Error('fetch failed')`: both classify correctly even
 * against the broken guard. It only appears with ofetch's real shape —
 * `response` present as an own key and set to `undefined`, because no
 * response ever arrived — which makes `'response' in error` true and lets
 * `error.response.status` throw *inside the catch block*, before any
 * status is assigned. The save button then stays on "Saving…" forever
 * and the author is never told their work did not leave the tab.
 */
function unreachableApi(): Error & { readonly response: undefined } {
  return Object.assign(new Error('fetch failed'), { response: undefined });
}

describe('useSavePage when the API never responded', () => {
  test('the fixture carries ofetch real shape, not a convenient mock', () => {
    const error = unreachableApi();

    expect('response' in error).toBe(true);
    expect(error.response).toBeUndefined();
  });

  test('settles into network-error instead of hanging on "Saving…"', async () => {
    const { status, message, save } = useSavePage(
      'page-1',
      vi.fn(async () => {
        throw unreachableApi();
      }),
    );

    const settled = await save('# Hi\n', 'hash-1').then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    );

    expect(status.value).not.toBe('saving');
    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try saving again/i);
    expect(settled).toBe('resolved');
  });
});
