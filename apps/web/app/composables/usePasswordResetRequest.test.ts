import { describe, expect, test } from 'vitest';
import { usePasswordResetRequest } from './usePasswordResetRequest';

describe('usePasswordResetRequest', () => {
  test('starts idle', () => {
    const { status } = usePasswordResetRequest(async () => ({ ok: true, message: 'generic' }));

    expect(status.value).toBe('idle');
  });

  test('a known account reaches the generic sent state', async () => {
    const { status, requestReset } = usePasswordResetRequest(async () => ({ ok: true, message: 'generic' }));

    await requestReset({ email: 'known@example.com' });

    expect(status.value).toBe('sent');
  });

  test('an unknown account reaches the byte-identical generic sent state — the non-disclosure guarantee', async () => {
    const { status, message, requestReset } = usePasswordResetRequest(async () => ({ ok: true, message: 'generic' }));

    await requestReset({ email: 'unknown@example.com' });

    expect(status.value).toBe('sent');
    expect(message.value).not.toMatch(/no account|does not exist|not found|unknown/i);
  });

  test('a network failure is its own state, distinct from the account outcome', async () => {
    const { status, message, requestReset } = usePasswordResetRequest(async () => {
      throw new Error('Failed to fetch');
    });

    await requestReset({ email: 'anyone@example.com' });

    expect(status.value).toBe('network-error');
    expect(message.value).not.toMatch(/failed to fetch/i);
  });
});
