/**
 * `trashNode()` — the whole `DELETE /nodes/:id` / `POST
 * /nodes/:id/force-delete` decision, one transaction (node-trash spec;
 * design.md Decision 3). `packages/core`'s `decideTrash()` folds the
 * gathered facts into a closed outcome; this module does nothing but
 * gather them, lock, propagate, and record.
 *
 * The 404-vs-403 split the `node-trash` spec's "subject without read"
 * scenario names is a caller (route) concern — this function is called
 * only after the route has already resolved `read` through `live_nodes`
 * (design.md Decision 3's "Reconciliation" paragraph). What this function
 * itself distinguishes is narrower: `not_found` when the node's own row is
 * absent or already trashed (including a race where a concurrent trash won
 * between the caller's own lookup and this transaction's lock), and
 * `forbidden` when the row exists but the caller holds neither `manage`
 * nor the owner rule.
 *
 * Ordering inside the transaction matters (design.md Decision 3):
 * 1. Lock the workspace row — the same count-then-write serialisation
 *    idiom `createNode`/`moveNode` use — *before* re-reading the node, so
 *    the live-descendant count and the propagation are one decision; a
 *    page created between the owner's confirmation and their submit is
 *    caught by `stale_count`, never silently trashed alongside the rest.
 * 2. Resolve the book (`resolveBookId`) and the ancestor breadcrumb while
 *    the node is still live — both walks would silently see nothing once
 *    this node drops out of `live_nodes`.
 * 3. Propagate (`trashLiveDescendants`), then compute `restricted`
 *    (`hasGrantsBetween`) over the ids just stamped — order does not
 *    matter for that query, unlike the two walks above.
 * 4. Release the subtree's page locks (page-content delta: presence is a
 *    view over locks and clears with them).
 * 5. Append the trace last, once everything it snapshots is final.
 */
import { decideTrash, type DecideTrashReason, type NodeType, type TrashMode, type TrashSubmission } from '@deep-wiki/core';
import type postgres from 'postgres';
import { resolveBookId } from '../changesets/resolve-changeset';
import { queryDescendantIds, trashLiveDescendants } from '../nodes/subtree';
import { hasGrantsBetween } from '../permissions/grants-between';
import { appendTrace } from './trace';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface TrashNodeInput {
  readonly nodeId: string;
  readonly actorId: string;
  readonly isOwner: boolean;
  readonly hasManage: boolean;
  readonly mode: TrashMode;
  readonly submitted?: TrashSubmission;
}

export interface TrashedCounts {
  readonly pages: number;
  readonly containers: number;
}

export type TrashNodeResult =
  | { readonly ok: true; readonly trashOperationId: string; readonly trashed: TrashedCounts }
  | { readonly ok: false; readonly reason: 'not_found' | 'forbidden' | 'name_mismatch' }
  | { readonly ok: false; readonly reason: Extract<DecideTrashReason, 'not_empty' | 'stale_count'>; readonly live: TrashedCounts };

interface NodeRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  type: NodeType;
  path: string;
  title: string;
}

interface AncestorRow {
  type: NodeType;
  title: string;
  depth: number;
}

/**
 * The ancestor chain's titles, nearest-book-first read as
 * shelf-to-nearest (`ORDER BY depth DESC`), excluding the workspace root —
 * shared with `listing.ts`, which needs the same walk as a live array
 * rather than a joined snapshot string.
 */
export async function ancestorTitles(sql: SqlExecutor, input: { readonly parentId: string | null }): Promise<readonly string[]> {
  if (!input.parentId) return [];
  const rows = await sql<AncestorRow[]>`
    WITH RECURSIVE ancestors(id, parent_id, type, title, depth) AS (
      SELECT id, parent_id, type, title, 0 FROM nodes WHERE id = ${input.parentId}
      UNION ALL
      SELECT n.id, n.parent_id, n.type, n.title, a.depth + 1
        FROM nodes n
        JOIN ancestors a ON n.id = a.parent_id
    )
    SELECT type, title, depth FROM ancestors WHERE type <> 'workspace' ORDER BY depth DESC
  `;
  return rows.map((row) => row.title);
}

export async function trashNode(sql: postgres.Sql, input: TrashNodeInput): Promise<TrashNodeResult> {
  return sql.begin(async (tx) => {
    const [preLock] = await tx<{ workspace_id: string }[]>`
      SELECT workspace_id FROM nodes WHERE id = ${input.nodeId} AND trashed_at IS NULL
    `;
    if (!preLock) return { ok: false, reason: 'not_found' };

    // Serialises trashing within this workspace (design.md Decision 3) —
    // the same portable row-lock idiom createNode/moveNode/reorderNode use.
    await tx`SELECT id FROM workspaces WHERE id = ${preLock.workspace_id} FOR UPDATE`;

    const [node] = await tx<NodeRow[]>`
      SELECT id, workspace_id, parent_id, type, path, title FROM nodes WHERE id = ${input.nodeId} AND trashed_at IS NULL
    `;
    if (!node) return { ok: false, reason: 'not_found' };

    const isContainer = node.type !== 'page';
    const liveDescendantIds = await queryDescendantIds(tx, {
      workspaceId: node.workspace_id,
      ancestorPath: node.path,
      excludeSelf: true,
      liveOnly: true,
    });

    const typeCounts =
      liveDescendantIds.length === 0
        ? []
        : await tx<{ type: NodeType; count: number }[]>`
            SELECT type, COUNT(*)::int AS count FROM nodes WHERE id = ANY(${liveDescendantIds}::uuid[]) GROUP BY type
          `;
    const pages = typeCounts.find((row) => row.type === 'page')?.count ?? 0;
    const containers = liveDescendantIds.length - pages;

    const decision = decideTrash({
      mode: input.mode,
      isOwner: input.isOwner,
      hasManage: input.hasManage,
      isContainer,
      live: { pages, containers },
      submitted: input.submitted,
      title: node.title,
    });

    if (!decision.ok) {
      if (decision.reason === 'not_empty' || decision.reason === 'stale_count') {
        return { ok: false, reason: decision.reason, live: { pages, containers } };
      }
      return { ok: false, reason: decision.reason };
    }

    // Both walks below must run before propagation: resolveBookId's own
    // anchor is `live_nodes`, and the ancestor walk's meaning ("where did
    // this live") is only accurate while the node is still live.
    const bookId = await resolveBookId(tx, { nodeId: node.id, workspaceId: node.workspace_id });
    const location = (await ancestorTitles(tx, { parentId: node.parent_id })).join(' › ');

    const operationId = crypto.randomUUID();
    const stampedIds = await trashLiveDescendants(tx, {
      workspaceId: node.workspace_id,
      ancestorPath: node.path,
      operationId,
      userId: input.actorId,
    });

    const restricted = await hasGrantsBetween(tx, { workspaceId: node.workspace_id, bookId, nodeIds: stampedIds });

    // page-content delta: presence is a view over locks and clears with them.
    await tx`DELETE FROM page_locks WHERE node_id = ANY(${stampedIds}::uuid[])`;

    await appendTrace(tx, {
      workspaceId: node.workspace_id,
      bookId,
      nodeId: node.id,
      nodeType: node.type,
      title: node.title,
      location,
      event: 'trashed',
      trashOperationId: operationId,
      actorId: input.actorId,
      pageCount: pages,
      restricted,
    });

    return { ok: true, trashOperationId: operationId, trashed: { pages, containers } };
  });
}
