/**
 * Page content routes (page-content spec; content-and-editor design.md
 * "The save transaction", "Fail-closed: the per-document probe"). Read
 * and save are both authorised through `can()`; save is guarded by
 * `content_hash` optimistic concurrency independently of any lock (D16).
 */
import { acquireLock, can, NotCanonicalError, readPageHtml, readPageMarkdown, savePage, StaleContentError } from '@deep-wiki/db';
import { probe } from '@deep-wiki/editor';
import { ErrorResponseSchema, SavePageRequestSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface PageRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
  readonly pageLockTtlSeconds: number;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface NodeRow {
  workspace_id: string;
}

export function createPageRoutes(deps: PageRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'read' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const content = await readPageHtml(deps.sql, { nodeId, workspaceId: node.workspace_id });
    if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    return c.json({ html: content.renderedHtml });
  });

  app.put('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const body = await readJsonBody(c.req.raw);
    const parsed = SavePageRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'markdown and expectedContentHash are required' }), 400);

    try {
      const result = await savePage(deps.sql, {
        nodeId,
        workspaceId: node.workspace_id,
        markdown: parsed.data.markdown,
        expectedContentHash: parsed.data.expectedContentHash,
        updatedBy: session.userId,
      });
      return c.json({ contentHash: result.contentHash });
    } catch (error) {
      if (error instanceof StaleContentError) {
        return c.json(ErrorResponseSchema.parse({ error: 'stale content: reload before saving again' }), 409);
      }
      if (error instanceof NotCanonicalError) {
        return c.json({ error: 'not canonical', canonical: error.canonical }, 409);
      }
      throw error;
    }
  });

  app.get('/pages/:id/edit-session', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const content = await readPageMarkdown(deps.sql, { nodeId, workspaceId: node.workspace_id });
    if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    // The probe and the lock acquisition both happen inside this one
    // request — a refused document never touches the lock at all.
    const result = probe(content.markdown);
    if (!result.ok) {
      return c.json(
        {
          reason: result.reason,
          construct: result.construct,
          line: result.line,
          offeredExits: ['read_only', 'normalise'],
        },
        409,
      );
    }

    const lock = await acquireLock(deps.sql, {
      nodeId,
      workspaceId: node.workspace_id,
      userId: session.userId,
      ttlSeconds: deps.pageLockTtlSeconds,
    });

    if (lock.outcome === 'held_by_other') {
      return c.json(
        {
          reason: 'locked',
          holder: { userId: lock.holderUserId, acquiredAt: lock.acquiredAt.toISOString(), heartbeatAt: lock.heartbeatAt.toISOString() },
          offeredExits: ['read_only', 'take_over'],
        },
        409,
      );
    }

    return c.json({
      markdown: content.markdown,
      lock: { holderUserId: lock.holderUserId, acquiredAt: lock.acquiredAt.toISOString(), heartbeatAt: lock.heartbeatAt.toISOString() },
    });
  });

  return app;
}
