import { afterEach, describe, expect, test, vi } from 'vitest';
import type { PresenceEventSourceLike } from './usePresenceStream';
import { closePresenceStreams, usePresenceStream } from './usePresenceStream';

// The connection is shared per workspace and outlives the screen that
// opened it (see the suite at the end), so each test starts with none.
afterEach(() => {
  closePresenceStreams();
  vi.useRealTimers();
});

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

    expect(editors.value).toEqual([{ pageId: 'page-1', pageTitle: 'A Page', userId: 'user-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);
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

  test('stop() clears this screen\'s editors at once, and closes the connection once nobody has wanted it for the linger window', async () => {
    vi.useFakeTimers();
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream('page-1', { createEventSource, lingerMs: 3_000 });

    start('ws-1');
    fake.emit('presence', presenceEvent());
    expect(editors.value).toHaveLength(1);

    stop();

    expect(editors.value).toEqual([]);
    // Not yet: the next screen in the same workspace is about to ask for it.
    await vi.advanceTimersByTimeAsync(2_999);
    expect(fake.closed).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.closed).toHaveBeenCalledTimes(1);
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
    expect(editors.value).toEqual([{ pageId: 'page-1', pageTitle: 'A Page', userId: 'user-1', userDisplayName: 'Ana', since: '2026-01-01T00:00:00.000Z' }]);

    stop();
    vi.useRealTimers();
  });
});

/**
 * The workspace dashboard's "editing now" column: one stream, every page.
 * `pageId: null` is the explicit statement that this consumer wants the
 * whole workspace — the same server-side per-event authorisation applies,
 * so an event for a page the subscriber may not read never arrives at all.
 */
describe('usePresenceStream across the whole workspace', () => {
  test('with `pageId: null`, editors of every page are kept, each naming its page', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream(null, { createEventSource });

    start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-1', userDisplayName: 'Ana' }));
    fake.emit('presence', presenceEvent({ pageId: 'page-2', userId: 'user-2', userDisplayName: 'Bo' }));

    expect(editors.value.map((editor) => [editor.pageId, editor.userDisplayName])).toEqual([
      ['page-1', 'Ana'],
      ['page-2', 'Bo'],
    ]);
    expect(editors.value[0]!.pageTitle).toBe('A Page');
    stop();
  });

  test('one person editing two pages is two entries, not one overwritten by the other', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);
    const { editors, start, stop } = usePresenceStream(null, { createEventSource });

    start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-1' }));
    fake.emit('presence', presenceEvent({ pageId: 'page-2', userId: 'user-1' }));

    expect(editors.value).toHaveLength(2);
    stop();
  });
});

/**
 * One stream per workspace, not per screen. Until 2026-09-16 every screen
 * owned its own `EventSource`, so a hop from one page to the next closed
 * the stream in `onBeforeUnmount` and opened a new one once the next
 * page's response had named the workspace — a fresh connection, a fresh
 * membership check and a fresh poll of the presence view on every click
 * (docs/TODO.md Findings, 2026-09-16, "edit-mode latency"). The connection
 * now lives with the workspace: a screen subscribes to it with its page
 * filter, a hop hands it from one subscriber to the next inside a linger
 * window, and it closes only once nobody has wanted it for that long.
 * The server still authorises every event per subscriber; the page filter
 * is only about what a screen has a place to render.
 */
describe('usePresenceStream is workspace-scoped', () => {
  test('two consecutive page hops open one stream', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);

    const first = usePresenceStream('page-1', { createEventSource });
    first.start('ws-1');
    first.stop(); // the first screen unmounts…

    const second = usePresenceStream('page-2', { createEventSource });
    second.start('ws-1'); // …and the next one asks for the same workspace

    expect(createEventSource).toHaveBeenCalledTimes(1);
    expect(fake.closed).not.toHaveBeenCalled();
    expect(second.connectionMode.value).toBe('sse');
  });

  test('a screen joining the shared stream sees only its own page, and what the stream already knew about it', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);

    const dashboard = usePresenceStream(null, { createEventSource });
    dashboard.start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-1', userDisplayName: 'Ana' }));
    fake.emit('presence', presenceEvent({ pageId: 'page-2', userId: 'user-2', userDisplayName: 'Bo' }));
    dashboard.stop();

    const pageTwo = usePresenceStream('page-2', { createEventSource });
    pageTwo.start('ws-1');

    // Known before this screen subscribed — a hop shows who is editing at once, not after the next heartbeat.
    expect(pageTwo.editors.value.map((editor) => editor.userDisplayName)).toEqual(['Bo']);
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-3', userDisplayName: 'Cy' }));
    expect(pageTwo.editors.value.map((editor) => editor.userDisplayName)).toEqual(['Bo']);
  });

  test('two screens on the same workspace share one connection and each filters it for themselves', () => {
    const fake = fakeEventSource();
    const createEventSource = vi.fn(() => fake.source);

    const pageOne = usePresenceStream('page-1', { createEventSource });
    const everything = usePresenceStream(null, { createEventSource });
    pageOne.start('ws-1');
    everything.start('ws-1');
    fake.emit('presence', presenceEvent({ pageId: 'page-1', userId: 'user-1' }));
    fake.emit('presence', presenceEvent({ pageId: 'page-2', userId: 'user-2' }));

    expect(createEventSource).toHaveBeenCalledTimes(1);
    expect(pageOne.editors.value).toHaveLength(1);
    expect(everything.editors.value).toHaveLength(2);

    // One leaving does not take the other's connection with it.
    pageOne.stop();
    expect(fake.closed).not.toHaveBeenCalled();
    expect(everything.editors.value).toHaveLength(2);
  });

  test('a different workspace is a different stream, and leaving one for another releases the first', async () => {
    vi.useFakeTimers();
    const sources = new Map<string, ReturnType<typeof fakeEventSource>>();
    const createEventSource = vi.fn((url: string) => {
      const fake = fakeEventSource();
      sources.set(url, fake);
      return fake.source;
    });

    const { start } = usePresenceStream(null, { createEventSource, lingerMs: 1_000 });
    start('ws-1');
    start('ws-2');

    expect([...sources.keys()].map((url) => url.split('/workspaces/')[1])).toEqual(['ws-1/presence/stream', 'ws-2/presence/stream']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect([...sources.values()].map((fake) => fake.closed.mock.calls.length)).toEqual([1, 0]);
  });

  test('the poll fallback is shared the same way: a hop does not restart the polling', async () => {
    vi.useFakeTimers();
    const pollOnce = vi.fn().mockResolvedValue([]);

    const first = usePresenceStream('page-1', { forcePollFallback: true, pollOnce, pollIntervalMs: 5_000 });
    first.start('ws-1');
    await vi.advanceTimersByTimeAsync(0);
    first.stop();
    const second = usePresenceStream('page-2', { forcePollFallback: true, pollOnce, pollIntervalMs: 5_000 });
    second.start('ws-1');
    await vi.advanceTimersByTimeAsync(0);

    expect(pollOnce).toHaveBeenCalledTimes(1);
    expect(second.connectionMode.value).toBe('poll');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pollOnce).toHaveBeenCalledTimes(2);
  });
});
