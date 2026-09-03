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

  test('reports a human-readable, non-technical message when the request cannot reach the API', async () => {
    const health = useApiHealth(async () => {
      throw new Error('Failed to fetch');
    });

    await health.check();

    expect(health.status.value).toBe('error');
    expect(health.message.value).toMatch(/cannot reach the api/i);
    expect(health.message.value).not.toMatch(/failed to fetch/i);
    expect(health.detail.value).toMatch(/failed to fetch/i);
  });

  test('distinguishes a response error from a network error in the user-facing message', async () => {
    const health = useApiHealth(async () => {
      throw Object.assign(new Error('Internal Server Error'), {
        response: { status: 500 },
      });
    });

    await health.check();

    expect(health.status.value).toBe('error');
    expect(health.message.value).toMatch(/api responded with an error/i);
    expect(health.detail.value).toMatch(/internal server error/i);
  });

  test('transitions to error when the response reports a non-ok status, without a bare status code in the message', async () => {
    const health = useApiHealth(async () => ({ status: 'degraded' }));

    await health.check();

    expect(health.status.value).toBe('error');
    expect(health.message.value).not.toMatch(/degraded/i);
    expect(health.detail.value).toMatch(/degraded/i);
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
