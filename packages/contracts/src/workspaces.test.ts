import { describe, expect, test } from 'bun:test';
import {
  CreateWorkspaceRefusalSchema,
  CreateWorkspaceRequestSchema,
  WorkspaceListResponseSchema,
  WorkspaceMembersResponseSchema,
  WorkspaceSummarySchema,
} from './workspaces';

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

describe('CreateWorkspaceRequestSchema', () => {
  test('accepts a name and a slug in the shape slugifyTitle produces', () => {
    const parsed = CreateWorkspaceRequestSchema.parse({ name: '  Acme Handbook ', slug: 'acme-handbook' });

    expect(parsed).toEqual({ name: 'Acme Handbook', slug: 'acme-handbook' });
  });

  test('refuses a slug that is not already in canonical form, so the URL can never disagree with what the user saw', () => {
    for (const slug of ['Acme Handbook', 'acme_handbook', '-acme', 'acme-', 'ACME', '', 'a'.repeat(97)]) {
      expect(CreateWorkspaceRequestSchema.safeParse({ name: 'Acme', slug }).success, `slug ${JSON.stringify(slug)}`).toBe(false);
    }
  });

  test('refuses a blank name', () => {
    expect(CreateWorkspaceRequestSchema.safeParse({ name: '   ', slug: 'acme' }).success).toBe(false);
  });
});

describe('CreateWorkspaceRefusalSchema', () => {
  test('a plan-limit refusal carries the plan name and the limit, so a screen can state the number', () => {
    const parsed = CreateWorkspaceRefusalSchema.parse({ error: 'limit', reason: 'plan_limit', planName: 'team', maxWorkspaces: 3 });

    expect(parsed).toEqual({ error: 'limit', reason: 'plan_limit', planName: 'team', maxWorkspaces: 3 });
  });

  test('a no-plan refusal and a taken-slug refusal are their own reasons', () => {
    expect(CreateWorkspaceRefusalSchema.safeParse({ error: 'x', reason: 'no_plan' }).success).toBe(true);
    expect(CreateWorkspaceRefusalSchema.safeParse({ error: 'x', reason: 'slug_taken' }).success).toBe(true);
    expect(CreateWorkspaceRefusalSchema.safeParse({ error: 'x', reason: 'something_else' }).success).toBe(false);
  });
});

describe('WorkspaceMembersResponseSchema', () => {
  test('parses members and pending invitations, and strips anything undeclared such as a token hash', () => {
    const parsed = WorkspaceMembersResponseSchema.parse({
      workspace: { id: 'ws-1', name: 'Alpha', slug: 'alpha', ownerId: 'u-0' },
      rootNodeId: 'n-1',
      members: [{ id: 'u-1', displayName: 'Ada', email: 'ada@example.com', passwordHash: 'x' }],
      invitations: [
        {
          id: 'i-1',
          email: 'new@example.com',
          startingGrants: [{ resourceId: 'n-1', action: 'read', effect: 'allow' }],
          createdAt: '2026-09-14T00:00:00.000Z',
          expiresAt: '2026-09-21T00:00:00.000Z',
          tokenHash: 'abc',
        },
      ],
      truncated: false,
    });

    expect(parsed.workspace).toEqual({ id: 'ws-1', name: 'Alpha', slug: 'alpha' });
    expect(parsed.members[0]).toEqual({ id: 'u-1', displayName: 'Ada', email: 'ada@example.com' });
    expect(parsed.invitations[0]).toEqual({
      id: 'i-1',
      email: 'new@example.com',
      startingGrants: [{ resourceId: 'n-1', action: 'read' }],
      createdAt: '2026-09-14T00:00:00.000Z',
      expiresAt: '2026-09-21T00:00:00.000Z',
    });
  });
});
