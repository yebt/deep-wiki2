import { describe, expect, test, vi } from 'vitest';
import { useWorkspaces } from './useWorkspaces';

function responseError(status: number) {
  return { response: { status } };
}

const alpha = { id: 'ws-1', name: 'Alpha Handbook', slug: 'alpha-handbook' };

describe('useWorkspaces', () => {
  test('starts idle and loads the list on success', async () => {
    const fetchWorkspaces = vi.fn(async () => ({ workspaces: [alpha] }));
    const { status, workspaces, load } = useWorkspaces({ fetchWorkspaces });

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(workspaces.value).toEqual([alpha]);
  });

  test('an empty list is success with zero workspaces, never an error', async () => {
    const fetchWorkspaces = vi.fn(async () => ({ workspaces: [] }));
    const { status, workspaces, load } = useWorkspaces({ fetchWorkspaces });

    await load();

    expect(status.value).toBe('success');
    expect(workspaces.value).toEqual([]);
  });

  test('a 401 is its own state, so the screen can offer sign-in instead of a retry', async () => {
    const { status, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw responseError(401);
      }),
    });

    await load();

    expect(status.value).toBe('unauthenticated');
  });

  test('an unreachable server is a recoverable error carrying a message the user can act on', async () => {
    const { status, message, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
  });

  test('a 500 is the same recoverable error, not a silent empty list', async () => {
    const { status, workspaces, load } = useWorkspaces({
      fetchWorkspaces: vi.fn(async () => {
        throw responseError(500);
      }),
    });

    await load();

    expect(status.value).toBe('network-error');
    expect(workspaces.value).toEqual([]);
  });
});
