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
