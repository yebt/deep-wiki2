import { describe, expect, test, vi } from 'vitest';
import type { PresenceEventSourceLike } from './usePresenceStream';
import { usePresenceStream } from './usePresenceStream';

/**
 * `PresenceEventSourceLike` fake that hands the test direct control over
 * when a `presence`/`error`/`open` event is dispatched — the real
 * `EventSource` is not available in this suite's environment (and even
 * where it is, driving it over real network timing is exactly the kind of
 * "the stream never emits" trap this suite exists to avoid).
 */
function fakeEventSource() {
  const handlers = new Map<string, (event: { readonly data?: string }) => void>();
  const closed = vi.fn();
  const source: PresenceEventSourceLike = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    close: closed,
  };
  return {
    source,
    closed,
    emit(type: 'presence' | 'error' | 'open', event: { readonly data?: string } = {}) {
      handlers.get(type)?.(event);
    },
  };
}

function presenceEvent(overrides: Partial<{ pageId: string; userId: string; userDisplayName: string; since: string }> = {}) {
  return {
    data: JSON.stringify({
      mode: 'editing',
      pageId: overrides.pageId ?? 'page-1',
      pageTitle: 'A Page',
      userId: overrides.userId ?? 'user-1',
      userDisplayName: overrides.userDisplayName ?? 'Ana',
      since: overrides.since ?? '2026-01-01T00:00:00.000Z',
    }),
  };
}

describe('usePresenceStream', () => {
  test('start() opens an EventSource against the workspace stream URL', () => {
    const created: string[] = [];
    const createEventSource = vi.fn((url: string) => {
      created.push(url);
      return fakeEventSource().source;
    });
    const { start, stop } = usePresenceStream('page-1', { createEventSource });

    start('ws-1');

    expect(created).toHaveLength(1);
    expect(created[0]).toContain('/workspaces/ws-1/presence/stream');
    stop();
  });

  test('an event naming this page becomes a visible editor', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', { createEventSource });

    start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-1', userDisplayName: 'Ana' }));

    expect(editors.value).toEqual([{ userId: 'user-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);
    stop();
  });

  // The trap this suite must not fall into: a presence test where the
  // stream never actually emits anything proves nothing about the
  // filtering logic under test. This asserts the *negative* directly.
  test('an event naming a different page is dropped, never surfacing as an editor of this one', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', { createEventSource });

    start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-2' }));

    expect(editors.value).toEqual([]);
    stop();
  });

  test('stop() closes the connection and clears the roster', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', { createEventSource });

    start('ws-1');
    fake.emit('presence', presenceEvent());
    expect(editors.value).toHaveLength(1);

    stop();

    expect(fake.closed).toHaveBeenCalledTimes(1);
    expect(editors.value).toEqual([]);
  });

  test('a dropped connection reconnects with backoff, not a tight retry loop', async () => {
    vi.useFakeTimers();
    const sources = [fakeEventSource(), fakeEventSource()];
    let call = 0;
    const createEventSource = vi.fn(() => sources[call++]!.source);
    const { connectionMode, start, stop } = usePresenceStream('page-1', {
      createEventSource,
      reconnectBaseMs: 1000,
      reconnectMaxMs: 8000,
    });

    start('ws-1');
    expect(createEventSource).toHaveBeenCalledTimes(1);

    sources[0]!.emit('error');
    expect(connectionMode.value).toBe('reconnecting');

    // Not yet — a dropped stream must not retry immediately.
    await vi.advanceTimersByTimeAsync(999);
    expect(createEventSource).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(createEventSource).toHaveBeenCalledTimes(2);

    stop();
    vi.useRealTimers();
  });

  test('a stale entry expires visibly once its heartbeat window lapses — advancing real (fake) time, not merely asserting immediately', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', {
      createEventSource,
      expiryMs: 10_000,
      expiryTickMs: 1_000,
    });

    start('ws-1');
    fake.emit('presence', presenceEvent());
    expect(editors.value).toHaveLength(1);

    // Still within the TTL window.
    await vi.advanceTimersByTimeAsync(9_000);
    expect(editors.value).toHaveLength(1);

    // Past it, with no renewing heartbeat in between — this is the case a
    // closed laptop produces, and it must stop showing as "editing".
    await vi.advanceTimersByTimeAsync(2_000);
    expect(editors.value).toEqual([]);

    stop();
    vi.useRealTimers();
  });

  test('a renewed heartbeat before expiry keeps the entry alive past the original window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', {
      createEventSource,
      expiryMs: 10_000,
      expiryTickMs: 1_000,
    });

    start('ws-1');
    fake.emit('presence', presenceEvent());

    await vi.advanceTimersByTimeAsync(8_000);
    fake.emit('presence', presenceEvent()); // renewed, same `since`
    await vi.advanceTimersByTimeAsync(8_000); // 16s total; would have expired without the renewal

    expect(editors.value).toHaveLength(1);
    stop();
    vi.useRealTimers();
  });

  test('falls back to polling the same endpoint when EventSource is unavailable', async () => {
    vi.useFakeTimers();
    const pollOnce = vi
      .fn()
      .mockResolvedValueOnce([
        { mode: 'editing' as const, pageId: 'page-1', pageTitle: 'A Page', userId: 'user-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' },
      ]);
    const { editors, connectionMode, start, stop } = usePresenceStream('page-1', {
      forcePollFallback: true,
      pollOnce,
      pollIntervalMs: 5000,
    });

    start('ws-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(connectionMode.value).toBe('poll');
    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(editors.value).toEqual([{ userId: 'user-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);

    stop();
    vi.useRealTimers();
  });
});
