/**
 * The navigation tree (navigation-tree spec): only readable nodes, resolved
 * through `can()`/`readableResourceIds` — never by looping `can()` per node
 * (design.md "Listing without disclosure"). Drag-reorder is a distinct
 * route, gated by `write` on the node being moved (spec: "Reordering
 * Requires Write Or Manage Permission").
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
import { can, readableResourceIds, reorderNode, CrossWorkspaceMoveError, CyclicMoveError, IllegalParentTypeError } from '@deep-wiki/db';
import { ErrorResponseSchema } from '@deep-wiki/contracts';
import { Hono } from 'hono';
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

export function createTreeRoutes(deps: TreeRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();
  const auth = sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes ?? 30 });

  app.get('/workspaces/:id/tree', auth, async (c) => {
    const workspaceId = c.req.param('id');
    const session = c.get('session');

    const [root] = await deps.sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND type = 'workspace' AND parent_id IS NULL
    `;
    if (!root) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

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

  // navigation-tree: Reordering Requires Write Or Manage Permission.
  app.patch('/nodes/:id/position', auth, async (c) => {
    const nodeId = c.req.param('id');
    const session = c.get('session');

    const [node] = await deps.sql<{ workspace_id: string }[]>`SELECT workspace_id FROM nodes WHERE id = ${nodeId}`;
    if (!node) return c.json(ErrorResponseSchema.parse({ error: 'not found' }), 404);

    const authorized = await can(deps.sql, { subjectType: 'user', subjectId: session.userId, resourceId: nodeId, action: 'write' });
    if (!authorized) return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);

    const body = await readJsonBody(c.req.raw);
    const parsed = ReorderRequestSchema.safeParse(body);
    if (!parsed.success) return c.json(ErrorResponseSchema.parse({ error: 'newParentId and newIndex are required' }), 400);

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

  return app;
}
