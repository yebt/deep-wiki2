/**
 * The navigation tree (navigation-tree spec): only readable nodes, resolved
 * through `can()`/`readableResourceIds` — never by looping `can()` per node
 * (design.md "Listing without disclosure"), and only for a caller who can
 * read something in this workspace at all. Drag-reorder is a distinct
 * route, gated by `write` on the node being moved *and* on both branches
 * the move rewrites (spec: "Reordering Requires Write Or Manage
 * Permission"; see the route for why the destination and the old parent
 * count).
 *
 * **Path-visible rule, recorded here because the spec states only the
 * single-level case.** A node is included only when its whole ancestor
 * chain up to the workspace root is *also* readable. The spec's own
 * scenario ("an unreadable chapter and its pages are absent") only proves
 * the no-override case; a node with an independent grant *underneath* an
 * unreadable ancestor would otherwise have to be surfaced as an orphan
 * with no visible parent, which is a real product decision this batch
 * does not make. Recorded as a TODO finding (see docs/TODO.md) rather than
 * silently choosing an unstated tree-reshaping behaviour.
 */
import {
  can,
  createNode,
  DuplicateSiblingSlugError,
  readableResourceIds,
  readableWorkspaceIds,
  renameNode,
  reorderNode,
  UnslugifiableTitleError,
  CrossWorkspaceMoveError,
  CyclicMoveError,
  IllegalParentTypeError,
} from '@deep-wiki/db';
import {
  CreateNodeRequestSchema,
  CreateNodeResponseSchema,
  ErrorResponseSchema,
  NodeLocationResponseSchema,
  RenameNodeRequestSchema,
  RenameNodeResponseSchema,
} from '@deep-wiki/contracts';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type postgres from 'postgres';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface TreeRouteDeps {
  readonly sql: postgres.Sql;
  readonly sessionIdleTimeoutMinutes?: number;
}

interface NodeRow {
  id: string;
  parent_id: string | null;
  type: string;
  slug: string;
  title: string;
  position: number;
  path: string;
}

export interface TreeNode {
  readonly id: string;
  readonly type: string;
  readonly slug: string;
  readonly title: string;
  readonly position: number;
  readonly children: readonly TreeNode[];
}

function depthOf(path: string): number {
  return path.split('/').filter(Boolean).length;
}

/** Builds the nested tree from the flat, permission-filtered row set, enforcing the path-visible rule above. */
function buildTree(rows: readonly NodeRow[], readable: ReadonlySet<string>, rootId: string): TreeNode[] {
  const byParent = new Map<string, NodeRow[]>();
  const sorted = [...rows].sort((a, b) => depthOf(a.path) - depthOf(b.path));
  const visible = new Set<string>([rootId]);

  for (const row of sorted) {
    if (row.parent_id && readable.has(row.id) && visible.has(row.parent_id)) {
      visible.add(row.id);
      const siblings = byParent.get(row.parent_id) ?? [];
      siblings.push(row);
      byParent.set(row.parent_id, siblings);
    }
  }

  function toTree(parentId: string): TreeNode[] {
    const children = (byParent.get(parentId) ?? []).sort((a, b) => a.position - b.position);
    return children.map((row) => ({
      id: row.id,
      type: row.type,
      slug: row.slug,
      title: row.title,
      position: row.position,
      children: toTree(row.id),
    }));
  }

  return toTree(rootId);
}

const ReorderRequestSchema = z.object({
  newParentId: z.string(),
  newIndex: z.number().int().min(0),
});

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Absence and denial-of-read answer with the *same* response object, from
 * the same call site — the precedent the comment, backlink and mention
 * routes already set (`comments.ts` — "Listing without disclosure"). A
 * caller with no `read` grant on a parent cannot tell "that node does not
 * exist" from "that node exists and you may not see it", because both
 * produce this exact body and this exact status.
 *
 * Denial of the *stronger* action is a different case and answers 403:
 * a caller who can read the parent already knows it exists, so naming
 * the missing `write` grant discloses nothing and tells them what to ask
 * for. Read is therefore always the first gate.
 */
function notFound(c: Context): Response {
  return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The one place a write to the tree resolves its target's permission.
 * Returns the node's row when the caller may write it, and otherwise the
 * response to send — so no call site can accidentally answer 403 where
 * this contract says 404.
 */
async function authorizeWrite(
  sql: postgres.Sql,
  c: Context,
  input: { readonly nodeId: string; readonly userId: string },
): Promise<
  { ok: true; node: { workspace_id: string; type: string; parent_id: string | null } } | { ok: false; response: Response }
> {
  const [node] = await sql<{ workspace_id: string; type: string; parent_id: string | null }[]>`
    SELECT workspace_id, type, parent_id FROM nodes WHERE id = ${input.nodeId}
  `;
  const canRead =
    node !== undefined &&
    (await can(sql, { subjectType: 'user', subjectId: input.userId, resourceId: input.nodeId, action: 'read' }));
  if (!node || !canRead) return { ok: false, response: notFound(c) };

  const canWrite = await can(sql, { subjectType: 'user', subjectId: input.userId, resourceId: input.nodeId, action: 'write' });
  if (!canWrite) return { ok: false, response: c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403) };

  return { ok: true, node };
}

/**
 * The refusals creation and rename share, mapped to status codes once.
 * `IllegalParentTypeError`'s message names both types, and
 * `DuplicateSiblingSlugError`'s quotes the name the user typed, so the
 * screen can show the reason rather than a code.
 */
function writeFailureResponse(c: Context, error: unknown): Response | null {
  if (error instanceof IllegalParentTypeError || error instanceof UnslugifiableTitleError) {
    return c.json(ErrorResponseSchema.parse({ error: error.message }), 400);
  }
  if (error instanceof DuplicateSiblingSlugError) {
    return c.json(ErrorResponseSchema.parse({ error: error.message }), 409);
  }
  return null;
}

export function createTreeRoutes(deps: TreeRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  /**
   * The caller's gate is the same question `GET /workspaces` answers —
   * `readableWorkspaceIds`, "the workspaces in which this subject can read
   * at least one node" — so the set of ids a client is handed is exactly
   * the set of ids that open. Anything else and the two endpoints disagree
   * about what a workspace id is worth.
   *
   * It is deliberately *not* `can(read)` on the root node: a member with a
   * grant on one shelf and none on the root reads that shelf's tree today,
   * and rooting the gate at the root would revoke it.
   *
   * **Absence and denial answer identically.** `readableResourceIds`
   * already emptied `nodes` for an outsider, but `rootId` came back
   * regardless and 200-versus-404 still separated a workspace that exists
   * from one that does not — and that root id is a valid `resourceId` for
   * `can()`, so it is the `pageId` and `newParentId` every other route
   * takes. Reading nothing *as a member* is still a 200 with an empty
   * `nodes` (workspaces.ts — "Reading nothing is a 200"); reading nothing
   * because you are not part of this workspace is a 404, byte-identical
   * to a workspace that was never created.
   */
  app.get('/workspaces/:id/tree', auth, async (c) => {
    const workspaceId = c.req.param('id');
    const session = c.get('session');

    const readableWorkspaces = await readableWorkspaceIds(deps.sql, { subjectType: 'user', subjectId: session.userId });
    if (!readableWorkspaces.has(workspaceId)) return notFound(c);

    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace' AND parent_id IS NULL
    `;
    if (!root) return notFound(c);

    const rows = await deps.sql<NodeRow[]>`
      SELECT id, parent_id, type, slug, title, position, path
        FROM nodes
       WHERE workspace_id = ${workspaceId} AND id <> ${root.id}
    `;

    const readable = await readableResourceIds(deps.sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: session.userId,
      resourceIds: rows.map((row) => row.id),
    });

    const nodes = buildTree(rows, readable, root.id);
    // The workspace's root node (type 'workspace') is deliberately never
    // itself a tree entry, but its id is what a top-level drag-drop must
    // target as `newParentId` — without it, the client has no legal
    // parent id to send when reordering a shelf among its siblings.
    return c.json({ rootId: root.id, nodes });
  });

  /**
   * `GET /nodes/:id/location` — which workspace a node lives in, by id and
   * by slug. The web app's addresses carry the workspace's slug
   * (`/w/<slug>/p/<id>`); an address that carries only a node id — the
   * `/pages/<id>` and `/books/<id>` shapes every link used to have, a bare
   * id pasted from somewhere — is turned into the real one by asking here
   * first. A locator and nothing more: no title, no content, no parent.
   *
   * **Absence and denial are the same answer.** `pages.ts` returns a real
   * 403 to a caller who asks for a page they may not read, because that
   * caller asked and is owed a coherent refusal (docs/UI-CHECKLIST.md
   * §3). Nobody asks this route; a redirect does, on the person's behalf,
   * and a 403 here would let anyone confirm that an id exists by watching
   * where an old link bounces. So a node the caller may not read, a node
   * that does not exist and an id that is not one are one 404, from the
   * one call site every other refusal in this file uses.
   */
  app.get('/nodes/:id/location', auth, async (c) => {
    const nodeId = c.req.param('id');
    // A non-uuid id would make the comparison below throw; it names
    // nothing and gets the same answer as an id that names nothing.
    if (!UUID_SHAPE.test(nodeId)) return notFound(c);
    const session = c.get('session');

    const [node] = await deps.sql<{ type: string; workspace_id: string; workspace_slug: string }[]>`
      SELECT n.type, n.workspace_id, w.slug AS workspace_slug
        FROM nodes n
        JOIN workspaces w ON w.id = n.workspace_id
       WHERE n.id = ${nodeId}
    `;
    const canRead = node !== undefined && (await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'read' }));
    if (!node || !canRead) return notFound(c);

    return c.json(
      NodeLocationResponseSchema.parse({ id: nodeId, type: node.type, workspaceId: node.workspace_id, workspaceSlug: node.workspace_slug }),
    );
  });

  /**
   * navigation-tree: Reordering Requires Write Or Manage Permission.
   *
   * **A move is a write to three things, not one.** `newParentId`
   * reparents, so the request changes the node, the branch that gains it
   * and the branch that loses it — and authorising only the node let a
   * caller holding nothing but `write` on their own book either publish
   * it (drop it under a shelf they cannot read, and that shelf's readers
   * inherit the whole subtree) or conceal it (drop a book the team
   * depends on into a subtree they cannot read, indistinguishable from
   * the deletion this product has deliberately not built).
   *
   * **`write`, on both parents.** Against `packages/core`'s action
   * lattice (`read < comment < write < manage`), `write` is the least
   * action that may change content, and `manage` is about administering
   * grants — requiring it would refuse ordinary drag-and-drop to the
   * writers the spec means to allow, and `write` already implies `read`,
   * so the gate cannot be passed by someone who cannot see the branch.
   * The precedent is one function down and exact: `POST /nodes` requires
   * `write` on the parent because *adding a child to a branch changes
   * that branch*. Putting an existing child there is the same act, and
   * `authorizeWrite` is therefore reused rather than reimplemented.
   *
   * **The old parent too.** Removal is the same change as addition, seen
   * from the branch that loses the child: its child list is what its
   * readers navigate. A same-parent reorder needs no second check — the
   * destination *is* the source. Its natural consequence is that dragging
   * a shelf among its siblings needs `write` on the workspace root, which
   * is exactly what creating a shelf there already needs.
   *
   * **404 before 403.** This route used to answer 403 for a node that
   * exists and the caller may not read, and 404 for one that does not —
   * the existence oracle `docs/TODO.md` (2026-09-08) recorded as a
   * follow-up when the comment routes were fixed. `authorizeWrite` has
   * answered it correctly for creation and rename since; using it here
   * closes the last case rather than adding a second rule.
   */
  app.patch('/nodes/:id/position', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const moved = await authorizeWrite(deps.sql, c, { nodeId, userId: session.userId });
    if (!moved.ok) return moved.response;

    const body = await readJsonBody(c.req.raw);
    const parsed = ReorderRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'newParentId and newIndex are required' }), 400);

    const destination = await authorizeWrite(deps.sql, c, { nodeId: parsed.data.newParentId, userId: session.userId });
    if (!destination.ok) return destination.response;

    // Only when the node actually leaves a branch. `parent_id` is null
    // only for the workspace root, which `assertLegalParent` refuses to
    // move at all.
    if (moved.node.parent_id !== null && moved.node.parent_id !== parsed.data.newParentId) {
      const source = await authorizeWrite(deps.sql, c, { nodeId: moved.node.parent_id, userId: session.userId });
      if (!source.ok) return source.response;
    }

    try {
      await reorderNode(deps.sql, { nodeId, newParentId: parsed.data.newParentId, newIndex: parsed.data.newIndex });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof CrossWorkspaceMoveError || error instanceof CyclicMoveError || error instanceof IllegalParentTypeError) {
        return c.json(ErrorResponseSchema.parse({ error: error.message }), 400);
      }
      throw error;
    }
  });

  /**
   * navigation-tree / docs/SPECS.md §3.1: creating a child requires
   * `write` on the **parent**, and legality is decided by the one
   * `LEGAL_PARENT_TYPES` table in `packages/core` — the same table that
   * refuses moving a book under a page.
   *
   * `workspace_id` is never read from the request: `createNode()` takes
   * it from the parent row, which is what makes the composite
   * `(id, workspace_id)` foreign key do its job instead of merely being
   * satisfied by a well-behaved caller.
   */
  app.post('/nodes', auth, async (c) => {
    const session = c.get('session');
    const body = await readJsonBody(c.req.raw);
    const parsed = CreateNodeRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(ErrorResponseSchema.parse({ error: 'parentId, type and title are required' }), 400);
    }

    const authorized = await authorizeWrite(deps.sql, c, { nodeId: parsed.data.parentId, userId: session.userId });
    if (!authorized.ok) return authorized.response;

    try {
      const created = await createNode(deps.sql, {
        parentId: parsed.data.parentId,
        type: parsed.data.type,
        title: parsed.data.title,
      });
      return c.json(
        CreateNodeResponseSchema.parse({
          id: created.id,
          parentId: created.parentId,
          type: created.type,
          slug: created.slug,
          title: created.title,
          position: created.position,
        }),
        201,
      );
    } catch (error) {
      const refusal = writeFailureResponse(c, error);
      if (refusal) return refusal;
      throw error;
    }
  });

  /**
   * Rename. `write` on the node itself, and the same slug-collision rule
   * creation applies one row earlier — `renameNode()` calls the very
   * function `createNode()` does, so the two cannot answer differently.
   */
  app.patch('/nodes/:id', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const body = await readJsonBody(c.req.raw);
    const parsed = RenameNodeRequestSchema.safeParse(body);

    const authorized = await authorizeWrite(deps.sql, c, { nodeId, userId: session.userId });
    if (!authorized.ok) return authorized.response;

    // Deliberately after the permission gate: a caller who may not see
    // this node must get the same answer whatever they sent.
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'title is required' }), 400);

    try {
      const renamed = await renameNode(deps.sql, { nodeId, title: parsed.data.title });
      return c.json(RenameNodeResponseSchema.parse(renamed));
    } catch (error) {
      const refusal = writeFailureResponse(c, error);
      if (refusal) return refusal;
      throw error;
    }
  });

  return app;
}
