/**
 * Backlinks (knowledge-graph spec: Backlinks Resolve Through can()). One
 * `SELECT` over `links` bounded by page size, then `readableResourceIds`
 * filters the candidate source pages — two statements, never N+1
 * (design.md "Listing without disclosure"). The count is computed over the
 * filtered set: an unreadable source page contributes nothing, not even
 * to the total.
 */
import { can, readableResourceIds } from '@deep-wiki/db';
import { ErrorResponseSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface LinkRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

const BACKLINK_CANDIDATE_LIMIT = 200;

export function createLinkRoutes(deps: LinkRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  app.get('/pages/:id/backlinks', auth, async (c) => {
    const targetId = c.req.param('id');
    const session = c.get('session');

    // Absence and denial-of-read answer with the same response from the
    // same call site: a caller with no grant cannot use this endpoint to
    // learn that the target page exists. Same rule as the comment routes,
    // and the singular analogue of `readableResourceIds` dropping an
    // unreadable id rather than reporting it as denied.
    const [target] = await deps.sql<{ workspace_id: string }[]>`SELECT workspace_id FROM nodes WHERE id = ${targetId}`;
    const authorized =
      target !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: targetId, action: 'read' }));
    if (!target || !authorized) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const candidates = await deps.sql<{ source_page_id: string }[]>`
      SELECT DISTINCT source_page_id FROM links
       WHERE workspace_id = ${target.workspace_id} AND target_page_id = ${targetId}
       LIMIT ${BACKLINK_CANDIDATE_LIMIT}
    `;
    const candidateIds = candidates.map((row) => row.source_page_id);

    const readable = await readableResourceIds(deps.sql, {
      workspaceId: target.workspace_id,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: candidateIds,
    });

    const survivorIds = candidateIds.filter((id) => readable.has(id));
    const pages =
      survivorIds.length === 0
        ? []
        : await deps.sql<{ id: string; title: string }[]>`SELECT id, title FROM nodes WHERE id = ANY(${survivorIds}::uuid[])`;

    // Counts are computed over the filtered set (design.md "Listing
    // without disclosure", rule 1) — never over the unfiltered candidates.
    return c.json({ total: pages.length, pages });
  });

  return app;
}
