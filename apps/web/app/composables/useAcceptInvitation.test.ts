import { describe, expect, test } from 'vitest';
import { useAcceptInvitation } from './useAcceptInvitation';

describe('useAcceptInvitation', () => {
  test('starts idle', () => {
    const { status } = useAcceptInvitation(async () => ({ ok: true, workspaceId: 'ws1' }));

    expect(status.value).toBe('idle');
  });

  test('transitions to success and carries the joined workspaceId', async () => {
    const { status, workspaceId, accept } = useAcceptInvitation(async () => ({ ok: true, workspaceId: 'ws1' }));

    await accept({ token: 't', password: 'p', displayName: 'New Member' });

    expect(status.value).toBe('success');
    expect(workspaceId.value).toBe('ws1');
  });

  test('an invalid token reaches its own "invalid" state (400)', async () => {
    const { status, accept } = useAcceptInvitation(async () => {
      throw Object.assign(new Error('Bad Request'), { response: { status: 400 } });
    });

    await accept({ token: 'garbage', password: 'p', displayName: 'X' });

    expect(status.value).toBe('invalid');
  });

  test('an expired invitation reaches its own "expired" state (410) — not a generic error', async () => {
    const { status, accept } = useAcceptInvitation(async () => {
      throw Object.assign(new Error('Gone'), { response: { status: 410 } });
    });

    await accept({ token: 'old', password: 'p', displayName: 'X' });

    expect(status.value).toBe('expired');
  });

  test('an already-accepted invitation reaches its own "already-used" state (409) — not a generic error', async () => {
    const { status, accept } = useAcceptInvitation(async () => {
      throw Object.assign(new Error('Conflict'), { response: { status: 409 } });
    });

    await accept({ token: 'used', password: 'p', displayName: 'X' });

    expect(status.value).toBe('already-used');
  });

  test('a network failure is its own state, distinct from every token outcome', async () => {
    const { status, message, accept } = useAcceptInvitation(async () => {
      throw new Error('Failed to fetch');
    });

    await accept({ token: 't', password: 'p', displayName: 'X' });

    expect(status.value).toBe('network-error');
    expect(message.value).not.toMatch(/failed to fetch/i);
  });
});
