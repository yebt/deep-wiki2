import { describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { bookHistoryKey, pageDiffKey, pageHistoryKey, pageReadKey, workspaceActivityKey } from '~/utils/api-keys';
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

  // `PUT /pages/:id` answers `unchanged: true` when the bytes sent were the
  // bytes stored — nothing written, no revision (revision-history spec via
  // `savePage()`). "Saved." would claim a revision that does not exist
  // (docs/UI-CHECKLIST.md §3, "Success — confirmed specifically").
  test('an unchanged answer is a success that says nothing changed, and clears nothing from the read cache', async () => {
    const payload = useNuxtApp().payload.data;
    payload[pageHistoryKey('page-1')] = { ok: true, value: { revisions: [] } };
    const fetcher = vi.fn(async () => ({ contentHash: 'hash-1', unchanged: true }));
    const { status, message, save } = useSavePage('page-1', fetcher);

    await save('# Hi\n', 'hash-1');

    expect(status.value).toBe('success');
    expect(message.value).toBe('Nothing changed since the last save.');
    expect(payload[pageHistoryKey('page-1')]).toEqual({ ok: true, value: { revisions: [] } });
  });

  test('a changed answer is confirmed as saved', async () => {
    const fetcher = vi.fn(async () => ({ contentHash: 'hash-2', unchanged: false }));
    const { message, save } = useSavePage('page-1', fetcher);

    await save('# Hi\n', 'hash-1');

    expect(message.value).toBe('Saved.');
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

  // Regression: commit 40f9844 made `PUT /pages/:id` answer 409 with
  // `{ error: 'dead anchor', corrected, anchors }` instead of a 500 when a
  // save reintroduces a retired block anchor. Before this fix, the guard
  // below only checked `typeof body.canonical === 'string'` — this fixture
  // has neither `canonical`, so it fell into the same `else` branch as an
  // actual concurrent-edit conflict and reported `stale`, telling the
  // author a collaborator raced them when no such collaborator exists.
  test('a 409 dead-anchor response reports dead-anchor (never stale) and offers the corrected document', async () => {
    const fetcher = vi.fn(async () => {
      throw responseError(409, {
        error: 'dead anchor',
        corrected: 'Zebras migrate north through dusty savannah every summer.\n',
        anchors: [{ id: 'abc1234567', status: 'tombstoned' }],
      });
    });
    const { status, corrected, anchors, save } = useSavePage('page-1', fetcher);

    await save('Zebras migrate north through dusty savannah every summer. ^abc1234567\n', 'hash-1');

    expect(status.value).not.toBe('stale');
    expect(status.value).toBe('dead-anchor');
    expect(corrected.value).toBe('Zebras migrate north through dusty savannah every summer.\n');
    expect(anchors.value).toEqual([{ id: 'abc1234567', status: 'tombstoned' }]);
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

  // The data layer keeps read answers across screens (`useApiRead`); a
  // save is the one write this app has that stales them, and the reader
  // the person goes back to must not render the page as it was.
  describe('invalidation', () => {
    test('a successful save clears the saved page, its history, and every book history and workspace activity from the read cache', async () => {
      const payload = useNuxtApp().payload.data;
      payload[pageReadKey('page-saved')] = { ok: true, value: { html: '<p>old</p>' } };
      payload[pageHistoryKey('page-saved')] = { ok: true, value: { revisions: [] } };
      payload[bookHistoryKey('book-any')] = { ok: true, value: {} };
      payload[workspaceActivityKey('ws-any')] = { ok: true, value: {} };
      payload[pageReadKey('page-other')] = { ok: true, value: { html: '<p>other</p>' } };
      payload[pageDiffKey('page-saved', 'r1', 'r2')] = { ok: true, value: {} };

      const { save } = useSavePage('page-saved', vi.fn(async () => ({ contentHash: 'hash-2' })));
      await save('# Hi\n', 'hash-1');

      expect(payload[pageReadKey('page-saved')]).toBeUndefined();
      expect(payload[pageHistoryKey('page-saved')]).toBeUndefined();
      expect(payload[bookHistoryKey('book-any')]).toBeUndefined();
      expect(payload[workspaceActivityKey('ws-any')]).toBeUndefined();
      expect(payload[pageReadKey('page-other')]).toEqual({ ok: true, value: { html: '<p>other</p>' } });
      expect(payload[pageDiffKey('page-saved', 'r1', 'r2')]).toEqual({ ok: true, value: {} });
    });

    test('a refused save clears nothing: what is cached is still what is stored', async () => {
      const payload = useNuxtApp().payload.data;
      payload[pageReadKey('page-refused')] = { ok: true, value: { html: '<p>kept</p>' } };

      const { save } = useSavePage('page-refused', vi.fn(async () => {
        throw responseError(409, { error: 'stale' });
      }));
      await save('# Hi\n', 'hash-1');

      expect(payload[pageReadKey('page-refused')]).toEqual({ ok: true, value: { html: '<p>kept</p>' } });
    });
  });
});
