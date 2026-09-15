import { describe, expect, test, vi } from 'vitest';
import { useWorkspaceActivity, type WorkspaceActivityResponse } from './useWorkspaceActivity';

function response(overrides: Partial<WorkspaceActivityResponse> = {}): WorkspaceActivityResponse {
  return { workspace: { id: 'ws-1', name: 'Acme' }, recent: [], mine: [], threads: [], ...overrides };
}

function responseError(status: number) {
  return { response: { status } };
}

describe('useWorkspaceActivity', () => {
  test('starts idle and lands in success with the three lists', async () => {
    const fetcher = vi.fn(async () =>
      response({
        recent: [
          {
            revisionId: 'r1',
            pageId: 'p1',
            pageTitle: 'Roadmap',
            author: { id: 'u1', displayName: 'Ana' },
            createdAt: '2026-09-15T10:00:00.000Z',
            changes: { added: 1, removed: 0, modified: 2, moved: 0 },
          },
        ],
      }),
    );
    const { status, recent, workspaceName, load } = useWorkspaceActivity('ws-1', fetcher);

    expect(status.value).toBe('idle');
    await load();

    expect(status.value).toBe('success');
    expect(workspaceName.value).toBe('Acme');
    expect(recent.value[0]!.pageTitle).toBe('Roadmap');
    expect(fetcher).toHaveBeenCalledWith('ws-1');
  });

  // Absence and denial are one state, because the route answers both with
  // one byte-identical 404 — a distinct `forbidden` here would undo that on
  // the one client that could tell.
  test('403 and 404 both land in not-found', async () => {
    const forbidden = useWorkspaceActivity('ws-1', vi.fn(async () => { throw responseError(403); }));
    await forbidden.load();
    expect(forbidden.status.value).toBe('not-found');

    const missing = useWorkspaceActivity('ws-1', vi.fn(async () => { throw responseError(404); }));
    await missing.load();
    expect(missing.status.value).toBe('not-found');
  });

  test('a dead connection is a recoverable network error with a message in the user\'s terms', async () => {
    const { status, message, load } = useWorkspaceActivity('ws-1', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await load();
    expect(status.value).toBe('network-error');
    expect(message.value).toMatch(/connection/i);
  });
});
