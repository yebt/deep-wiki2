import { describe, expect, test } from 'vitest';
import { usePasswordResetConfirm } from './usePasswordResetConfirm';

describe('usePasswordResetConfirm', () => {
  test('starts idle', () => {
    const { status } = usePasswordResetConfirm(async () => ({ ok: true }));

    expect(status.value).toBe('idle');
  });

  test('transitions to success on a valid token and password', async () => {
    const { status, confirmReset } = usePasswordResetConfirm(async () => ({ ok: true }));

    await confirmReset({ token: 't', newPassword: 'brand-new-password' });

    expect(status.value).toBe('success');
  });

  test('an expired or already-used token reaches its own state, not a generic error', async () => {
    const { status, message, confirmReset } = usePasswordResetConfirm(async () => {
      throw Object.assign(new Error('Bad Request'), { response: { status: 400 } });
    });

    await confirmReset({ token: 'stale', newPassword: 'brand-new-password' });

    expect(status.value).toBe('invalid-or-expired');
    expect(message.value).toMatch(/invalid|expired/i);
  });

  test('a network failure is distinct from an invalid token', async () => {
    const { status, message, confirmReset } = usePasswordResetConfirm(async () => {
      throw new Error('Failed to fetch');
    });

    await confirmReset({ token: 't', newPassword: 'brand-new-password' });

    expect(status.value).toBe('network-error');
    expect(message.value).not.toMatch(/failed to fetch/i);
  });
});
