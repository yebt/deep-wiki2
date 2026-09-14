import { describe, expect, test } from 'bun:test';
import { ReadPageResponseSchema } from './pages';

describe('ReadPageResponseSchema', () => {
  // The read screen opens the workspace-scoped presence stream
  // (`GET /workspaces/:workspaceId/presence/stream`) and has nowhere else
  // to learn the id from without a side effect: `GET /pages/:id/edit-session`
  // is the only other route that carries it, and it acquires the edit lock.
  test('carries the workspace id, so a read-only screen can open presence without acquiring the lock', () => {
    const parsed = ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi', workspaceId: 'ws-1' });

    expect(parsed.workspaceId).toBe('ws-1');
  });

  test('a response without a workspace id is rejected — the field is required, not optional', () => {
    expect(() => ReadPageResponseSchema.parse({ html: '<p>Hi</p>', title: 'Hi' })).toThrow();
  });
});
