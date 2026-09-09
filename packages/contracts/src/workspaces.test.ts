import { describe, expect, test } from 'bun:test';
import { WorkspaceListResponseSchema, WorkspaceSummarySchema } from './workspaces';

describe('WorkspaceSummarySchema', () => {
  test('parses the three fields the workspace list renders and links from', () => {
    const parsed = WorkspaceSummarySchema.parse({ id: 'ws-1', name: 'Handbook', slug: 'handbook' });

    expect(parsed).toEqual({ id: 'ws-1', name: 'Handbook', slug: 'handbook' });
  });

  test('rejects a summary with no id, which is what the tree link is built from', () => {
    const result = WorkspaceSummarySchema.safeParse({ name: 'Handbook', slug: 'handbook' });

    expect(result.success).toBe(false);
    if (result.success) return;

    expect(result.error.issues.map((issue) => issue.path)).toEqual([['id']]);
  });
});

describe('WorkspaceListResponseSchema', () => {
  test('parses a list of workspaces', () => {
    const parsed = WorkspaceListResponseSchema.parse({
      workspaces: [
        { id: 'ws-1', name: 'Alpha', slug: 'alpha' },
        { id: 'ws-2', name: 'Bravo', slug: 'bravo' },
      ],
    });

    expect(parsed.workspaces.map((w) => w.id)).toEqual(['ws-1', 'ws-2']);
  });

  test('parses an empty list — reading no workspaces is a state, not a malformed response', () => {
    const parsed = WorkspaceListResponseSchema.parse({ workspaces: [] });

    expect(parsed.workspaces).toEqual([]);
  });

  test('drops a field the schema does not declare, so a widened query cannot leak one', () => {
    const parsed = WorkspaceListResponseSchema.parse({
      workspaces: [{ id: 'ws-1', name: 'Alpha', slug: 'alpha', ownerId: 'user-42', settings: { secret: true } }],
    });

    expect(parsed.workspaces[0]).toEqual({ id: 'ws-1', name: 'Alpha', slug: 'alpha' });
  });
});
