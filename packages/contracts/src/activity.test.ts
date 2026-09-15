import { describe, expect, test } from 'bun:test';
import { WorkspaceActivityResponseSchema } from './activity';

/**
 * `GET /workspaces/:id/activity` — the workspace dashboard's three lists
 * in one response. The schema is what keeps the response honest about its
 * shape: a change carries its class counts, a thread says whether it is
 * waiting on the caller, and nothing in any list carries a page the
 * caller may not read (that is the route's job; this only fixes the shape).
 */
describe('WorkspaceActivityResponseSchema', () => {
  test('parses a response with a change, a thread and a personal edit', () => {
    const parsed = WorkspaceActivityResponseSchema.parse({
      workspace: { id: 'ws-1', name: 'Acme' },
      recent: [
        {
          revisionId: 'rev-1',
          pageId: 'page-1',
          pageTitle: 'Roadmap',
          author: { id: 'u-1', displayName: 'Ana' },
          createdAt: '2026-09-15T10:00:00.000Z',
          changes: { added: 2, removed: 1, modified: 3, moved: 0 },
        },
      ],
      mine: [{ revisionId: 'rev-1', pageId: 'page-1', pageTitle: 'Roadmap', createdAt: '2026-09-15T10:00:00.000Z' }],
      threads: [
        {
          id: 't-1',
          pageId: 'page-1',
          pageTitle: 'Roadmap',
          quote: 'the launch date',
          orphaned: false,
          author: { id: 'u-2', displayName: 'Bo' },
          replyCount: 2,
          lastActivityAt: '2026-09-15T10:00:00.000Z',
          mentionsYou: true,
          awaitsYou: true,
        },
      ],
    });

    expect(parsed.recent[0]!.changes.modified).toBe(3);
    expect(parsed.threads[0]!.awaitsYou).toBe(true);
  });

  test('strips revision content: the dashboard is a list, never a bulk content dump', () => {
    const parsed = WorkspaceActivityResponseSchema.parse({
      workspace: { id: 'ws-1', name: 'Acme' },
      recent: [
        {
          revisionId: 'rev-1',
          pageId: 'page-1',
          pageTitle: 'Roadmap',
          author: { id: null, displayName: null },
          createdAt: '2026-09-15T10:00:00.000Z',
          changes: { added: 0, removed: 0, modified: 0, moved: 0 },
          content: '# secret',
        },
      ],
      mine: [],
      threads: [],
    });

    expect('content' in parsed.recent[0]!).toBe(false);
  });

  test('rejects a change whose class counts are missing', () => {
    const result = WorkspaceActivityResponseSchema.safeParse({
      workspace: { id: 'ws-1', name: 'Acme' },
      recent: [{ revisionId: 'rev-1', pageId: 'page-1', pageTitle: 'Roadmap', author: { id: null, displayName: null }, createdAt: 'x' }],
      mine: [],
      threads: [],
    });
    expect(result.success).toBe(false);
  });
});
