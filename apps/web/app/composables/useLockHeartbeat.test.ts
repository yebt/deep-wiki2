import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_HEARTBEAT_INTERVAL_MS, useLockHeartbeat } from './useLockHeartbeat';

/**
 * `start()` is called the instant `GET /pages/:id/edit-session` has
 * acquired the lock — a response that already carries the lock's
 * `heartbeatAt`. A beat fired in that same instant renewed a lock that
 * was 100 ms old (measured 2026-09-16, docs/TODO.md Findings "edit-mode
 * latency": one redundant PATCH on every open, on the critical path).
 * The session is the first beat; the composable's own first beat is one
 * interval later.
 */
describe('useLockHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('start() sends nothing at once: the first heartbeat is one interval after the session acquired the lock', async () => {
    const fetcher = vi.fn(async () => ({ status: 'ok' as const }));
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    expect(fetcher).not.toHaveBeenCalled();
    expect(status.value).toBe('idle');

    await vi.advanceTimersByTimeAsync(1000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('page-1');
    expect(status.value).toBe('ok');
    stop();
  });

  test('then repeats every interval', async () => {
    const fetcher = vi.fn(async () => ({ status: 'ok' as const }));
    const { start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetcher).toHaveBeenCalledTimes(3);
    stop();
  });

  test('the default interval is the server’s PAGE_LOCK_HEARTBEAT_SECONDS default, 20 s', () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(20_000);
  });

  test('a heartbeat reporting "lost" is reflected without throwing, and stops the timer', async () => {
    const fetcher = vi.fn(async () => ({ status: 'lost' as const }));
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(status.value).toBe('lost');

    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    stop();
  });

  test('stop() prevents further heartbeats', async () => {
    const fetcher = vi.fn(async () => ({ status: 'ok' as const }));
    const { start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetcher).not.toHaveBeenCalled();
  });

  test('a network failure reports the recoverable network-error state, not an unhandled rejection', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    await vi.advanceTimersByTimeAsync(1000);

    expect(status.value).toBe('network-error');
    stop();
  });
});
