import { describe, expect, test } from 'vitest';
import { useApiHealth } from './useApiHealth';

describe('useApiHealth', () => {
  test('starts idle, before any check has run', () => {
    const health = useApiHealth(async () => ({ status: 'ok' }));

    expect(health.status.value).toBe('idle');
    expect(health.checkedAt.value).toBeNull();
  });

  test('transitions to ok and reports a human-readable message on success', async () => {
    const health = useApiHealth(async () => ({ status: 'ok' }));

    await health.check();

    expect(health.status.value).toBe('ok');
    expect(health.message.value).toMatch(/reachable/i);
    expect(health.checkedAt.value).not.toBeNull();
  });

  test('transitions to error and names the failure when the request rejects', async () => {
    const health = useApiHealth(async () => {
      throw new Error('network down');
    });

    await health.check();

    expect(health.status.value).toBe('error');
    expect(health.message.value).toMatch(/network down/i);
  });

  test('transitions to error when the response reports a non-ok status', async () => {
    const health = useApiHealth(async () => ({ status: 'degraded' }));

    await health.check();

    expect(health.status.value).toBe('error');
  });

  test('reports loading synchronously while the check is in flight', () => {
    let resolveCheck: (() => void) | undefined;
    const health = useApiHealth(
      () =>
        new Promise((resolve) => {
          resolveCheck = () => resolve({ status: 'ok' });
        }),
    );

    const pending = health.check();
    expect(health.status.value).toBe('loading');

    resolveCheck?.();
    return pending;
  });
});
