import { describe, expect, test, vi } from 'vitest';
import { usePageDiff } from './usePageDiff';

/**
 * `GET /pages/:id/diff?from=&to=` (block-diff spec). Absence and
 * denial-of-read collapse into the SAME `not-found` status, mirroring
 * `usePageHistory` — the route itself returns a byte-identical 404 for
 * both (`apps/api/src/routes/diff.ts`).
 */
describe('usePageDiff', () => {
  test('starts idle and moves through loading to success with the diff as the server sent it', async () => {
    const diff = {
      from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
      to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
      changes: [{ kind: 'added' as const, id: 'b1', slot: 0, text: 'New paragraph.' }],
    };
    const fetcher = vi.fn(async () => ({ diff }));
    const { status, diff: result, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    expect(status.value).toBe('idle');
    const promise = load();
    expect(status.value).toBe('loading');
    await promise;

    expect(status.value).toBe('success');
    expect(result.value).toEqual(diff);
    expect(fetcher).toHaveBeenCalledWith('page-1', 'rev-1', 'rev-2');
  });

  test('two revisions with no differences resolve to success with every change unchanged, not an error', async () => {
    const diff = {
      from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' },
      to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' },
      changes: [{ kind: 'unchanged' as const, id: 'b1', slot: 0, text: 'Same paragraph.' }],
    };
    const fetcher = vi.fn(async () => ({ diff }));
    const { status, diff: result, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    await load();

    expect(status.value).toBe('success');
    expect(result.value?.changes.every((c) => c.kind === 'unchanged')).toBe(true);
  });

  test('a 404 (absence or denial, indistinguishable) resolves to the single not-found state', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 404 } };
    });
    const { status, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  // A 401 is neither denial nor a dead connection: the person is signed
  // out, and the screen's next move is sign-in (`useSignInRedirect`), not
  // a retry that would 401 again. Before 2026-09-16 it fell through to
  // network-error and the screen said "Cannot reach the server".
  test('a 401 resolves to unauthenticated, not to a network error', async () => {
    const { status, load } = usePageDiff('page-1', 'rev-1', 'rev-2', vi.fn(async () => { throw { response: { status: 401 } }; }));
    await load();
    expect(status.value).toBe('unauthenticated');
  });

  test('a 403 ALSO resolves to not-found, not a distinct forbidden state — the non-disclosure requirement', async () => {
    const fetcher = vi.fn(async () => {
      throw { response: { status: 403 } };
    });
    const { status, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a network failure with no response resolves to the recoverable network-error state', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, message, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/cannot reach/i);
  });

  test('load can be retried after a network error and succeed', async () => {
    let attempt = 0;
    const diff = { from: { id: 'rev-1', createdAt: '2026-01-01T00:00:00.000Z' }, to: { id: 'rev-2', createdAt: '2026-01-02T00:00:00.000Z' }, changes: [] };
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('fetch failed');
      return { diff };
    });
    const { status, load } = usePageDiff('page-1', 'rev-1', 'rev-2', fetcher);

    await load();
    expect(status.value).toBe('network-error');

    await load();
    expect(status.value).toBe('success');
  });
});
