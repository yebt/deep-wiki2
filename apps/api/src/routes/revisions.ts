/**
 * `GET /pages/:id/history` (revision-history spec: "Page History Query
 * Returns Revisions Newest First"). Absence and denial-of-read share one
 * response, the same shape `comments.ts`/`mentions.ts` already use: a
 * caller with no grant cannot tell "this page does not exist" from "this
 * page exists and you may not see it".
 */
import { can, listPageRevisions } from '@deep-wiki/db';
import { ErrorResponseSchema, PageHistoryResponseSchema } from '@deep-wiki/contracts';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface RevisionRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
}

interface NodeRow {
  workspace_id: string;
}

function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

export function createRevisionRoutes(deps: RevisionRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id/history', auth, async (c) => {
    const pageId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${pageId}`;
    const canRead =
      node !== undefined &&
      (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: pageId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    const revisions = await listPageRevisions(deps.sql, { pageId, workspaceId: node.workspace_id });

    return c.json(
      PageHistoryResponseSchema.parse({
        revisions: revisions.map((revision) => ({
          id: revision.id,
          authorId: revision.authorId,
          createdAt: revision.createdAt.toISOString(),
          changesetId: revision.changesetId,
        })),
      }),
    );
  });

  return app;
}
