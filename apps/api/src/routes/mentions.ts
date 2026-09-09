/**
 * Mention/wiki-link autocomplete filtered by can() (document-editor spec:
 * Mention Autocomplete Is Filtered By can(); knowledge-graph spec: Link
 * And Mention Autocomplete Never Discloses Unreadable Pages), plus the
 * explicit mismatch check document-editor's "Mentioning A User Does Not
 * Silently Grant Them Access" requires.
 */
import { can, listWorkspaceMemberCandidates, readableResourceIds, readableSubjectIds } from '@deep-wiki/db';
import { ErrorResponseSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface MentionRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

const PAGE_CANDIDATE_LIMIT = 50;
const PAGE_SUGGESTION_LIMIT = 10;
const SUBJECT_CANDIDATE_LIMIT = 50;

export function createMentionRoutes(deps: MentionRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  // design.md "Listing without disclosure" — Page mentions row: title
  // prefix search bounded at LIMIT 50, filtered through
  // canManyResources(read), first 10 survivors returned.
  app.get('/mentions/pages', auth, async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const query = c.req.query('q') ?? '';
    const session = c.get('session');
    if (!workspaceId) return c.json(ErrorResponseSchema.parse({ error: 'workspaceId is required' }), 400);

    const candidates = await deps.sql<{ id: string; title: string }[]>`
      SELECT id, title FROM nodes
       WHERE workspace_id = ${workspaceId} AND type = 'page' AND title ILIKE ${`${query}%`}
       ORDER BY title
       LIMIT ${PAGE_CANDIDATE_LIMIT}
    `;

    const readable = await readableResourceIds(deps.sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: candidates.map((row) => row.id),
    });

    const pages = candidates.filter((row) => readable.has(row.id)).slice(0, PAGE_SUGGESTION_LIMIT);
    return c.json({ pages });
  });

  // design.md "Listing without disclosure" — User / cell mentions row:
  // workspace membership -> canManySubjects(read, thisPage) -> a subject
  // who cannot read this page is not a candidate. "Workspace membership"
  // is anyone with a recorded grant in this workspace, a cell member, or
  // the workspace owner — there is no separate membership table yet.
  app.get('/mentions/subjects', auth, async (c) => {
    const workspaceId = c.req.query('workspaceId');
    const pageId = c.req.query('pageId');
    const query = c.req.query('q') ?? '';
    if (!workspaceId || !pageId) return c.json(ErrorResponseSchema.parse({ error: 'workspaceId and pageId are required' }), 400);

    const candidates = await listWorkspaceMemberCandidates(deps.sql, {
      workspaceId,
      query,
      limit: SUBJECT_CANDIDATE_LIMIT,
    });

    const readers = await readableSubjectIds(deps.sql, {
      workspaceId,
      resourceId: pageId,
      subjectIds: candidates.map((row) => row.id),
    });

    const subjects = candidates.filter((row) => readers.has(row.id));
    return c.json({ subjects });
  });

  // document-editor: Mentioning A User Does Not Silently Grant Them
  // Access — an explicit check the editor calls when a mention is
  // inserted, so a mismatch is surfaced rather than assumed resolved.
  app.get('/pages/:id/mentions/:userId/check', auth, async (c) => {
    const pageId = c.req.param('id');
    const mentionedUserId = c.req.param('userId');
    const session = c.get('session');

    // The caller must hold read on the page before this endpoint answers
    // anything about it — otherwise `200 {canRead}` versus `404` is itself
    // a page-existence oracle for a caller with no grant. Absence and
    // denial-of-read share one response, as on the comment routes.
    const [node] = await deps.sql<{ workspace_id: string }[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const callerCanRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !callerCanRead) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const canRead = await can(deps.sql, { subjectType: 'user', subjectId: mentionedUserId, resourceId: pageId, action: 'read' });
    return c.json({ canRead });
  });

  return app;
}
