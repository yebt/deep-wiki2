import { describe, expect, test, vi } from 'vitest';
import { useLockHeartbeat } from './useLockHeartbeat';

describe('useLockHeartbeat', () => {
  test('start() sends one heartbeat immediately and reports ok', async () => {
    const fetcher = vi.fn(async () => ({ status: 'ok' as const }));
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 100_000 });

    await start();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith('page-1');
    expect(status.value).toBe('ok');
    stop();
  });

  test('a heartbeat reporting "lost" is reflected without throwing', async () => {
    const fetcher = vi.fn(async () => ({ status: 'lost' as const }));
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 100_000 });

    await start();

    expect(status.value).toBe('lost');
    stop();
  });

  test('stop() prevents further heartbeats', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => ({ status: 'ok' as const }));
    const { start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 1000 });

    await start();
    stop();
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetcher).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  test('a network failure reports the recoverable network-error state, not an unhandled rejection', async () => {
    const fetcher = vi.fn(async () => {
      throw new Error('fetch failed');
    });
    const { status, start, stop } = useLockHeartbeat('page-1', fetcher, { intervalMs: 100_000 });

    await start();

    expect(status.value).toBe('network-error');
    stop();
  });
});
