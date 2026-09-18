/**
 * The trash surface (node-trash, trash-restore, trash-non-disclosure specs;
 * design.md Decision 3, 4, 7): `DELETE /nodes/:id`, `POST
 * /nodes/:id/force-delete`, `GET /workspaces/:ref/trash`, `GET
 * /trash/nodes/:id`, `POST /trash/:operationId/restore`.
 *
 * **404 before 403, exactly `tree.ts`'s `authorizeWrite` precedent.** A
 * subject with no `read` on the target answers the same 404 an unknown id
 * gets; a subject who can read it but holds neither `manage` nor the owner
 * rule is told so with a named 403 (design.md Decision 3's
 * "Reconciliation" — a caller who can already read the node discloses
 * nothing new by being refused write to it). `trashNode()`'s own
 * `not_found`/`forbidden` split is narrower (node absent-or-already-trashed
 * vs. exists-but-unauthorised) — the read gate below is what turns that
 * into the 404-vs-403 the route promises, per design.md Decision 3's own
 * text: "this function is called only after the route has already resolved
 * `read` through `live_nodes`".
 */
import {
  ErrorResponseSchema,
  ForceDeleteRequestSchema,
  NameMismatchRefusalSchema,
  NotEmptyRefusalSchema,
  RestoreAncestorTrashedRefusalSchema,
  RestoreRequestSchema,
  RestoreResponseSchema,
  RestoreSlugTakenRefusalSchema,
  StaleCountRefusalSchema,
  TrashListingResponseSchema,
  TrashLookupResponseSchema,
  TrashNodeResponseSchema,
} from '@deep-wiki/contracts';
import { can, listManageableTrash, readableWorkspaceIds, restoreOperation, trashLookup, trashNode } from '@deep-wiki/db';
import { Hono, type Context } from 'hono';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';
import { resolveWorkspaceId } from './workspace-ref';

export interface TrashRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Absence and denial-of-read answer with this exact body, from this one call site (`tree.ts`'s `notFound` precedent). */
function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

function forbidden(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
}

interface AuthorizedTarget {
  readonly workspaceId: string;
  readonly isOwner: boolean;
  readonly hasManage: boolean;
}

/**
 * The one place `DELETE /nodes/:id` and `POST /nodes/:id/force-delete`
 * resolve their target's read/manage/owner facts — 404 without `read`,
 * gathered facts otherwise, so no call site can answer 403 where this
 * contract says 404.
 */
async function authorizeTarget(
  sql: postgres.Sql,
  c: Context,
  input: { readonly nodeId: string; readonly userId: string },
): Promise<{ ok: true; target: AuthorizedTarget } | { ok: false; response: Response }> {
  const [node] = await sql<{ workspace_id: string }[]>`SELECT workspace_id FROM live_nodes WHERE id = ${input.nodeId}`;
  const canRead =
    node !== undefined && (await can(sql, { subjectType: 'user', subjectId: input.userId, resourceId: input.nodeId, action: 'read' }));
  if (!node || !canRead) return { ok: false, response: notFound(c) };

  const [workspace] = await sql<{ owner_id: string }[]>`SELECT owner_id FROM workspaces WHERE id = ${node.workspace_id}`;
  const isOwner = workspace?.owner_id === input.userId;
  const hasManage = await can(sql, { subjectType: 'user', subjectId: input.userId, resourceId: input.nodeId, action: 'manage' });

  return { ok: true, target: { workspaceId: node.workspace_id, isOwner, hasManage } };
}

function serializeTrashListingItem(item: Awaited<ReturnType<typeof listManageableTrash>>[number]) {
  return {
    operationId: item.operationId,
    root: item.root,
    location: item.location,
    trashedBy: item.trashedBy,
    trashedAt: item.trashedAt.toISOString(),
    purgeAt: item.purgeAt.toISOString(),
    daysLeft: item.daysLeft,
    pages: item.pages,
    containers: item.containers,
    restoreBlockedBy: item.restoreBlockedBy,
  };
}

function serializeTrashLookup(result: NonNullable<Awaited<ReturnType<typeof trashLookup>>>) {
  return {
    operationId: result.operationId,
    trashedAt: result.trashedAt.toISOString(),
    trashedBy: result.trashedBy,
    daysLeft: result.daysLeft,
    restoreBlockedBy: result.restoreBlockedBy,
  };
}

export function createTrashRoutes(deps: TrashRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  // node-trash: "Trashing Requires Manage Or The Owner Force Rule";
  // "A Non-Empty Container Requires The Owner Force Rule".
  app.delete('/nodes/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const authorized = await authorizeTarget(deps.sql, c, { nodeId, userId: session.userId });
    if (!authorized.ok) return authorized.response;
    const { isOwner, hasManage } = authorized.target;
    if (!hasManage && !isOwner) return forbidden(c);

    const result = await trashNode(deps.sql, { nodeId, actorId: session.userId, isOwner, hasManage, mode: 'trash' });
    if (!result.ok) {
      switch (result.reason) {
        case 'not_found':
          return notFound(c);
        case 'forbidden':
        case 'name_mismatch':
          // 'name_mismatch' is structurally unreachable for mode: 'trash'
          // (decideTrash only checks the submitted name in 'force' mode);
          // kept so the switch is exhaustive rather than assuming it away.
          return forbidden(c);
        default:
          // 'not_empty' | 'stale_count' — only 'not_empty' is reachable for
          // the plain route (design.md Decision 3).
          return c.json(
            NotEmptyRefusalSchema.parse({ error: 'not_empty', pages: result.live.pages, containers: result.live.containers, canForce: isOwner }),
            409,
          );
      }
    }

    return c.json(TrashNodeResponseSchema.parse({ trashOperationId: result.trashOperationId, trashed: result.trashed }));
  });

  // node-trash: "Owner Force-Delete Requires The Typed Name And A
  // Server-Verified Count". The gate is identical to the plain route; only
  // the owner may submit this route at all (design.md Decision 3).
  app.post('/nodes/:id/force-delete', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const authorized = await authorizeTarget(deps.sql, c, { nodeId, userId: session.userId });
    if (!authorized.ok) return authorized.response;
    const { isOwner, hasManage } = authorized.target;
    if (!isOwner) return forbidden(c);

    const body = await readJsonBody(c.req.raw);
    const parsed = ForceDeleteRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'confirmName and acceptedCount are required' }), 400);

    const result = await trashNode(deps.sql, {
      nodeId,
      actorId: session.userId,
      isOwner,
      hasManage,
      mode: 'force',
      submitted: parsed.data,
    });
    if (!result.ok) {
      switch (result.reason) {
        case 'not_found':
          return notFound(c);
        case 'forbidden':
          return forbidden(c);
        case 'name_mismatch':
          return c.json(NameMismatchRefusalSchema.parse({ error: 'name_mismatch' }), 409);
        case 'stale_count':
          return c.json(StaleCountRefusalSchema.parse({ error: 'stale_count', pages: result.live.pages, containers: result.live.containers }), 409);
        default:
          return c.json(
            NotEmptyRefusalSchema.parse({ error: 'not_empty', pages: result.live.pages, containers: result.live.containers, canForce: isOwner }),
            409,
          );
      }
    }

    return c.json(TrashNodeResponseSchema.parse({ trashOperationId: result.trashOperationId, trashed: result.trashed }));
  });

  // trash-restore: "Trash Listing Shows Only What The Subject May Manage".
  // Gated like `tree.ts`'s own tree read: `readableWorkspaceIds`, never
  // `can(read)` on the root — a member with a grant on one shelf and none
  // on the root still reaches this listing.
  app.get('/workspaces/:ref/trash', auth, async (c) => {
    const session = c.get('session');
    const workspaceId = await resolveWorkspaceId(deps.sql, c.req.param('ref'));
    if (!workspaceId) return notFound(c);

    const readableWorkspaces = await readableWorkspaceIds(deps.sql, { subjectType: 'user', subjectId: session.userId });
    if (!readableWorkspaces.has(workspaceId)) return notFound(c);

    const items = await listManageableTrash(deps.sql, { workspaceId, subjectType: 'user', subjectId: session.userId });
    return c.json(TrashListingResponseSchema.parse({ items: items.map(serializeTrashListingItem) }));
  });

  // design.md Decision 7: feeds the "in the trash" state on a page screen.
  // 404 unless trashed AND manage — a non-manager and an unknown id are the
  // same answer.
  app.get('/trash/nodes/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const result = await trashLookup(deps.sql, { nodeId, subjectId: session.userId });
    if (!result) return notFound(c);

    return c.json(TrashLookupResponseSchema.parse(serializeTrashLookup(result)));
  });

  // trash-restore: "Restore Returns The Node And Exactly The Subtree
  // Trashed With It"; "Restore Under A Trashed Ancestor Is Refused"; "A
  // Slug Collision On Restore Answers 409"; "Restore As Accepts A Typed
  // Name". A trashed op id the caller may not manage answers the same
  // `not_found` an unknown one does (design.md Decision 4) — there is
  // nothing for this route to gate ahead of `restoreOperation()` itself.
  app.post('/trash/:operationId/restore', auth, async (c) => {
    const operationId = c.req.param('operationId');
    const session = c.get('session');

    const body = await readJsonBody(c.req.raw);
    const parsed = RestoreRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'invalid restore request' }), 400);

    const result = await restoreOperation(deps.sql, { trashOperationId: operationId, actorId: session.userId, name: parsed.data.name });
    if (!result.ok) {
      if (result.reason === 'not_found') return notFound(c);
      if (result.reason === 'ancestor_trashed') {
        return c.json(RestoreAncestorTrashedRefusalSchema.parse({ error: 'ancestor_trashed', ancestor: result.ancestor }), 409);
      }
      return c.json(RestoreSlugTakenRefusalSchema.parse({ error: 'slug_taken', sibling: result.sibling }), 409);
    }

    return c.json(RestoreResponseSchema.parse({ nodeId: result.nodeId, parentId: result.parentId, slug: result.slug }));
  });

  return app;
}
