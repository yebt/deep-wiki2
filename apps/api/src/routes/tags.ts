/**
 * Tag-filtered navigation (knowledge-graph spec: Tag-Filtered Navigation
 * Resolves Through can()). Session is required (a workspace's tag list is
 * still tenant-owned content), but no per-tag permission gates the query
 * itself — `readableResourceIds` is what actually keeps an unreadable
 * tagged page out of the response.
 */
import { readableResourceIds } from '@deep-wiki/db';
import { ErrorResponseSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface TagRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

const TAG_PAGE_CANDIDATE_LIMIT = 200;

export function createTagRoutes(deps: TagRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  app.get('/tags/:name/pages', auth, async (c) => {
    const name = c.req.param('name');
    const workspaceId = c.req.query('workspaceId');
    const session = c.get('session');

    if (!workspaceId) return c.json(ErrorResponseSchema.parse({ error: 'workspaceId is required' }), 400);

    const candidates = await deps.sql<{ id: string }[]>`
      SELECT n.id
        FROM page_tags pt
        JOIN tags t ON t.id = pt.tag_id
        JOIN live_nodes n ON n.id = pt.page_id
       WHERE t.workspace_id = ${workspaceId} AND t.name = ${name}
       LIMIT ${TAG_PAGE_CANDIDATE_LIMIT}
    `;
    const candidateIds = candidates.map((row) => row.id);

    const readable = await readableResourceIds(deps.sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: candidateIds,
    });

    const survivorIds = candidateIds.filter((id) => readable.has(id));
    const pages =
      survivorIds.length === 0
        ? []
        : await deps.sql<{ id: string; title: string }[]>`SELECT id, title FROM live_nodes WHERE id = ANY(${survivorIds}::uuid[])`;

    return c.json({ pages });
  });

  return app;
}
