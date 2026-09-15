/**
 * Page content routes (page-content spec; content-and-editor design.md
 * "The save transaction", "Fail-closed: the per-document probe"). Read
 * and save are both authorised through `can()`; save is guarded by
 * `content_hash` optimistic concurrency independently of any lock (D16).
 */
import {
  acquireLock,
  can,
  DeadAnchorError,
  heartbeatLock,
  NotCanonicalError,
  readPageHtml,
  readPageMarkdown,
  savePage,
  StaleContentError,
  takeOverLock,
} from '@deep-wiki/db';
import { probe } from '@deep-wiki/editor';
import type { PresenceBroadcaster } from '@deep-wiki/core';
import { ErrorResponseSchema, SavePageRequestSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface PageRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes: number;
  readonly pageLockTtlSeconds: number;
  /** `CHANGESET_WINDOW_MINUTES`, threaded from `loadConfig()` exactly as `pageLockTtlSeconds` is. */
  readonly changesetWindowMinutes: number;
  /** Threaded straight into `heartbeatLock()` — presence's only write path (editing-presence spec). Optional so callers that do not care about presence keep working. */
  readonly broadcaster?: PresenceBroadcaster;
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
  title: string;
}

export function createPageRoutes(deps: PageRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'read' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const content = await readPageHtml(deps.sql, { nodeId, workspaceId: node.workspace_id });
    if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    return c.json({ html: content.renderedHtml, title: node.title, workspaceId: node.workspace_id });
  });

  app.put('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM nodes WHERE id = ${nodeId}`;
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
        changesetWindowMinutes: deps.changesetWindowMinutes,
      });
      return c.json({ contentHash: result.contentHash });
    } catch (error) {
      if (error instanceof StaleContentError) {
        return c.json(ErrorResponseSchema.parse({ error: 'stale content: reload before saving again' }), 409);
      }
      if (error instanceof NotCanonicalError) {
        return c.json({ error: 'not canonical', canonical: error.canonical }, 409);
      }
      if (error instanceof DeadAnchorError) {
        return c.json({ error: 'dead anchor', corrected: error.corrected, anchors: error.anchors }, 409);
      }
      throw error;
    }
  });

  app.get('/pages/:id/edit-session', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const content = await readPageMarkdown(deps.sql, { nodeId, workspaceId: node.workspace_id });
    if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    // The probe and the lock acquisition both happen inside this one
    // request — a refused document never touches the lock at all.
    const result = probe(content.markdown);
    if (!result.ok) {
      // `line` is on every refusal; `construct` only on `unsupported_construct`
      // (a `not_byte_identical` document parsed fine — there is no offending
      // construct to name, only the line where the bytes first diverge).
      // edit.vue renders both, so each is forwarded whenever the probe has it.
      return c.json(
        {
          reason: result.reason,
          ...(result.reason === 'unsupported_construct' ? { construct: result.construct } : {}),
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
      title: node.title,
      workspaceId: node.workspace_id,
      contentHash: content.contentHash,
      lock: { holderUserId: lock.holderUserId, acquiredAt: lock.acquiredAt.toISOString(), heartbeatAt: lock.heartbeatAt.toISOString() },
    });
  });

  // document-modes: Heartbeat Keeps The Lock Alive. Requires `write`, same
  // as acquiring the lock in the first place; a displaced holder's own
  // heartbeat reports `lost` rather than silently reviving a lock that is
  // no longer theirs (design.md "The displaced editor cannot overwrite").
  app.patch('/pages/:id/lock', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const status = await heartbeatLock(deps.sql, {
      nodeId,
      workspaceId: node.workspace_id,
      userId: session.userId,
      broadcaster: deps.broadcaster,
    });
    return c.json({ status });
  });

  // document-modes: "Take Over" Transfers The Lock. The caller must be
  // explicit and confirmed client-side before this request is sent — the
  // route itself always transfers unconditionally, exactly as
  // `takeOverLock` is documented to.
  app.post('/pages/:id/lock/take-over', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const content = await readPageMarkdown(deps.sql, { nodeId, workspaceId: node.workspace_id });
    if (!content) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const lock = await takeOverLock(deps.sql, { nodeId, workspaceId: node.workspace_id, userId: session.userId });

    return c.json({
      markdown: content.markdown,
      title: node.title,
      workspaceId: node.workspace_id,
      contentHash: content.contentHash,
      lock: { holderUserId: lock.holderUserId, acquiredAt: lock.acquiredAt.toISOString(), heartbeatAt: lock.heartbeatAt.toISOString() },
    });
  });

  return app;
}
