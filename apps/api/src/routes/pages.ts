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
  PageNotFoundError,
  readPageHtml,
  readPageMarkdown,
  readTrashedPageHtml,
  savePage,
  StaleContentError,
  takeOverLock,
  trashLookup,
} from '@deep-wiki/db';
import { probe } from '@deep-wiki/editor';
import type { PresenceBroadcaster } from '@deep-wiki/core';
import { ErrorResponseSchema, SavePageRequestSchema, SavePageResponseSchema } from '@deep-wiki/contracts';
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

/** The same row with its workspace's slug — what a node response names beside the id (`NodeWorkspaceSchema`). */
interface LocatedNodeRow extends NodeRow {
  workspace_slug: string;
}

/**
 * Every route in this file resolves its node through `live_nodes`
 * (trash-non-disclosure spec): a trashed page must answer identically to
 * an unknown one, for read and for every write this file exposes (save,
 * the edit-session probe, the lock heartbeat, and the lock take-over) —
 * the manager's trash block on `GET /pages/:id` is wired separately in
 * Phase 6, after `trashLookup` exists.
 */
function locateNode(sql: postgres.Sql, nodeId: string): Promise<LocatedNodeRow[]> {
  return sql<LocatedNodeRow[]>`
    SELECT n.workspace_id, n.title, w.slug AS workspace_slug
      FROM live_nodes n
      JOIN workspaces w ON w.id = n.workspace_id
     WHERE n.id = ${nodeId}
  `;
}

function workspaceOf(node: LocatedNodeRow): { id: string; slug: string } {
  return { id: node.workspace_id, slug: node.workspace_slug };
}

/**
 * A page node exists from the moment the tree creates it; its
 * `page_content` row exists only from its first save. `readPageHtml` and
 * `readPageMarkdown` answer `undefined` for both "no content row" and "a
 * trashed page's content", and this file — the only caller of either — is
 * where those two are told apart: every handler below has already resolved
 * the node through `live_nodes`, so past that gate `undefined` can only
 * mean the row was never written.
 *
 * Which is not absence. A page the caller may read, that exists and is
 * live, with no content yet, is an EMPTY DOCUMENT. Until 2026-09-23 the
 * read route returned `404 not found` for it, so a page created from the
 * tree — visible in the tree, named in the breadcrumb — answered "This page
 * does not exist" the moment it was opened (docs/TODO.md Findings,
 * 2026-09-23; the line dates to the original read route, 6f3ef93). No test
 * caught it because every fixture in this repository saved content first.
 *
 * The defaults live here rather than inside `read-page.ts` on purpose: a
 * db-layer default would turn a *trashed* page's content read into an empty
 * document for any future caller that forgot the `live_nodes` gate, and
 * "trashed answers identically to unknown" is exactly what
 * `scripts/checks/trash-filter.ts` exists to protect. Absence stays
 * absence; the empty document is only ever reached past the gate.
 */
const NEVER_SAVED_HTML = { renderedHtml: '' } as const;
/** `contentHash: null` is what `savePage()` reads as "the first save" (D16). */
const NEVER_SAVED_MARKDOWN = { markdown: '', contentHash: null } as const;

export function createPageRoutes(deps: PageRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes });

  app.get('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await locateNode(deps.sql, nodeId);
    if (!node) {
      // design.md Decision 7 / page-content spec delta: "A manager can
      // still read a trashed page's content". `trashLookup` already folds
      // "trashed AND manage" into one null-or-not answer, so a former
      // reader without manage falls straight through to the same 404 an
      // unknown id gets, one call site below.
      const trash = await trashLookup(deps.sql, { nodeId, subjectId: session.userId });
      if (!trash) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

      const content = await readTrashedPageHtml(deps.sql, { nodeId, workspaceId: trash.workspaceId });
      return c.json({
        html: content?.renderedHtml ?? '',
        title: trash.title,
        workspaceId: trash.workspaceId,
        workspace: { id: trash.workspaceId, slug: trash.workspaceSlug },
        trash: {
          operationId: trash.operationId,
          trashedAt: trash.trashedAt.toISOString(),
          trashedBy: trash.trashedBy,
          daysLeft: trash.daysLeft,
          restoreBlockedBy: trash.restoreBlockedBy,
        },
      });
    }

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'read' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    // Never 404 past the `can()` gate: see `NEVER_SAVED_HTML`.
    const content = (await readPageHtml(deps.sql, { nodeId, workspaceId: node.workspace_id })) ?? NEVER_SAVED_HTML;

    return c.json({ html: content.renderedHtml, title: node.title, workspaceId: node.workspace_id, workspace: workspaceOf(node) });
  });

  app.put('/pages/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM live_nodes WHERE id = ${nodeId}`;
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
      return c.json(SavePageResponseSchema.parse({ contentHash: result.contentHash, unchanged: result.unchanged }));
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
      // Defence in depth: the live_nodes lookup above already refuses a
      // trashed or unknown page before this point, but savePage() carries
      // the same check for its other callers (comments.ts's anchor mint),
      // so a race between the two never surfaces as a raw 500.
      if (error instanceof PageNotFoundError) {
        return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
      }
      throw error;
    }
  });

  app.get('/pages/:id/edit-session', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await locateNode(deps.sql, nodeId);
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    // A page with no content row opens an empty editor, not a refusal (see
    // `NEVER_SAVED_MARKDOWN`): the author's first edit is the whole point of
    // the node the tree just created. `probe('')` already accepts an empty
    // document — an author who *clears* a page stores exactly these bytes —
    // and `acquireLock` can hold a lock on a page before its first save
    // since 0023 moved `page_locks`' foreign key onto `nodes`.
    const content = (await readPageMarkdown(deps.sql, { nodeId, workspaceId: node.workspace_id })) ?? NEVER_SAVED_MARKDOWN;

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
          workspace: workspaceOf(node),
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
          workspace: workspaceOf(node),
        },
        409,
      );
    }

    return c.json({
      markdown: content.markdown,
      title: node.title,
      workspaceId: node.workspace_id,
      workspace: workspaceOf(node),
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

    const [node] = await deps.sql<NodeRow[]>`SELECT workspace_id, title FROM live_nodes WHERE id = ${nodeId}`;
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

    const [node] = await locateNode(deps.sql, nodeId);
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    // Same rule as the edit session this take-over displaces: a page whose
    // first save has not happened yet hands the new holder an empty document
    // and a `null` hash, not a refusal (see `NEVER_SAVED_MARKDOWN`).
    const content = (await readPageMarkdown(deps.sql, { nodeId, workspaceId: node.workspace_id })) ?? NEVER_SAVED_MARKDOWN;

    const lock = await takeOverLock(deps.sql, { nodeId, workspaceId: node.workspace_id, userId: session.userId });

    return c.json({
      markdown: content.markdown,
      title: node.title,
      workspaceId: node.workspace_id,
      workspace: workspaceOf(node),
      contentHash: content.contentHash,
      lock: { holderUserId: lock.holderUserId, acquiredAt: lock.acquiredAt.toISOString(), heartbeatAt: lock.heartbeatAt.toISOString() },
    });
  });

  return app;
}
