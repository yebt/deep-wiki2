import { beforeAll, describe, expect, test, vi } from 'vitest';
import { useNuxtApp } from '#imports';
import { useWorkspaceMembers } from './useWorkspaceMembers';

function responseError(status: number, data?: unknown) {
  return { response: { status }, data };
}

const listing = {
  workspace: { id: 'ws-1', name: 'Acme Handbook', slug: 'acme-handbook' },
  rootNodeId: 'root-1',
  members: [{ id: 'u-1', displayName: 'Ada', email: 'ada@example.com' }],
  invitations: [
    {
      id: 'i-1',
      email: 'new@example.com',
      startingGrants: [{ resourceId: 'root-1', action: 'read' as const }],
      createdAt: '2026-09-14T00:00:00.000Z',
      expiresAt: '2026-09-21T00:00:00.000Z',
    },
  ],
  truncated: false,
};

/**
 * Every test reads its own id: the read layer (`useApiRead`) keeps one
 * answer per key across screens — that is the cache — so two tests sharing
 * an id would share an answer. And the test app never leaves hydration on
 * its own (there is no server render to resolve), so each file says it is
 * on the client, where `load()` fetches.
 */
let ids = 0;
function nextId(prefix: string): string {
  ids += 1;
  return `${prefix}-${ids}`;
}

beforeAll(() => {
  useNuxtApp().isHydrating = false;
});

describe('useWorkspaceMembers — load', () => {
  test('starts idle and loads the members and pending invitations on success', async () => {
    const fetchMembers = vi.fn(async () => listing);
    const { status, listing: data, load } = useWorkspaceMembers(nextId('ws'), { fetchMembers });

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(data.value).toEqual(listing);
    expect(fetchMembers).toHaveBeenCalledWith(expect.stringMatching(/^ws-\d+$/));
  });

  test('a 404 is the not-found state — which is also what a workspace the caller cannot manage answers', async () => {
    const { status, load } = useWorkspaceMembers(nextId('ws'), {
      fetchMembers: vi.fn(async () => {
        throw responseError(404);
      }),
    });

    await load();

    expect(status.value).toBe('not-found');
  });

  test('a 401 is its own state, so the screen can offer sign-in instead of a retry', async () => {
    const { status, load } = useWorkspaceMembers(nextId('ws'), {
      fetchMembers: vi.fn(async () => {
        throw responseError(401);
      }),
    });

    await load();

    expect(status.value).toBe('unauthenticated');
  });

  test('an unreachable server is a recoverable error carrying a message the user can act on', async () => {
    const { status, message, load } = useWorkspaceMembers(nextId('ws'), {
      fetchMembers: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });

    await load();

    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/try again/i);
  });
});

describe('useWorkspaceMembers — invite', () => {
  test('a valid invitation is posted against the workspace root and the listing is reloaded so it appears as pending', async () => {
    const fetchMembers = vi.fn(async () => listing);
    const postInvitation = vi.fn(async () => ({ ok: true as const }));
    // The screen asks by the slug its address carries; the invitation names
    // the workspace by the id the listing answered with.
    const { inviteStatus, inviteMessage, load, invite } = useWorkspaceMembers(nextId('acme'), { fetchMembers, postInvitation });
    await load();
    fetchMembers.mockClear();

    await invite({ email: 'Newbie@Example.com', action: 'write' });

    expect(inviteStatus.value).toBe('sent');
    expect(inviteMessage.value).toMatch(/newbie@example\.com/i);
    expect(postInvitation).toHaveBeenCalledWith({
      workspaceId: listing.workspace.id,
      email: 'newbie@example.com',
      startingGrants: [{ resourceId: 'root-1', action: 'write' }],
    });
    expect(fetchMembers).toHaveBeenCalledTimes(1);
  });

  test('a malformed email is refused before any request is made', async () => {
    const postInvitation = vi.fn(async () => ({ ok: true as const }));
    const { inviteStatus, load, invite } = useWorkspaceMembers(nextId('ws'), { fetchMembers: vi.fn(async () => listing), postInvitation });
    await load();

    await invite({ email: 'not-an-email', action: 'read' });

    expect(inviteStatus.value).toBe('invalid');
    expect(postInvitation).not.toHaveBeenCalled();
  });

  test('a refused invitation is a recoverable error and the listing is left as it was', async () => {
    const fetchMembers = vi.fn(async () => listing);
    const { inviteStatus, inviteMessage, load, invite } = useWorkspaceMembers(nextId('ws'), {
      fetchMembers,
      postInvitation: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    await load();
    fetchMembers.mockClear();

    await invite({ email: 'someone@example.com', action: 'read' });

    expect(inviteStatus.value).toBe('network-error');
    expect(inviteMessage.value).toMatch(/try again/i);
    expect(fetchMembers).not.toHaveBeenCalled();
  });

  test('a 404 on send means the workspace is no longer the caller\'s to manage, and the screen is told so', async () => {
    const { inviteStatus, load, invite } = useWorkspaceMembers(nextId('ws'), {
      fetchMembers: vi.fn(async () => listing),
      postInvitation: vi.fn(async () => {
        throw responseError(404);
      }),
    });
    await load();

    await invite({ email: 'someone@example.com', action: 'read' });

    expect(inviteStatus.value).toBe('not-found');
  });
});
