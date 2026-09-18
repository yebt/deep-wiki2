/**
 * `restoreOperation()` — `POST /trash/:operationId/restore` (trash-restore
 * spec; design.md Decision 4). Restoring by operation id, never by node
 * id: a node id would have to re-derive "what came with it" from
 * ancestry, resurrecting a descendant someone else deleted on purpose.
 *
 * The gate is uniform, unlike `trashNode()`'s 404/403 split: "a trashed op
 * id must be indistinguishable from an unknown one" (Decision 4), so both
 * "no such operation" and "operation exists but the caller cannot manage
 * its root" answer `not_found`. Resolving the op root is this function's
 * own first step — the caller only has an operation id, never the root's
 * node id, so there is nothing for a route to gate ahead of this call.
 */
import { decideRestore, slugifyTitle } from '@deep-wiki/core';
import type postgres from 'postgres';
import { can } from '../permissions/queries';
import { appendTrace, findTrashedTrace } from './trace';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface RestoreOperationInput {
  readonly trashOperationId: string;
  readonly actorId: string;
  /** "Restore as …" — a caller-typed replacement name, never a minted suffix. */
  readonly name?: string;
}

export type RestoreOperationResult =
  | { readonly ok: true; readonly nodeId: string; readonly parentId: string; readonly slug: string }
  | { readonly ok: false; readonly reason: 'not_found' }
  | { readonly ok: false; readonly reason: 'ancestor_trashed'; readonly ancestor: { readonly title: string } }
  | { readonly ok: false; readonly reason: 'slug_taken'; readonly sibling: { readonly title: string } };

interface OpRootRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  slug: string;
  title: string;
}

/** The row of the operation whose parent is not itself part of the operation. */
async function findOpRoot(sql: SqlExecutor, trashOperationId: string): Promise<OpRootRow | undefined> {
  const [root] = await sql<OpRootRow[]>`
    SELECT n.id, n.workspace_id, n.parent_id, n.slug, n.title
      FROM nodes n
      LEFT JOIN nodes p ON p.id = n.parent_id
     WHERE n.trash_operation_id = ${trashOperationId}
       AND (p.id IS NULL OR p.trash_operation_id IS DISTINCT FROM n.trash_operation_id)
     LIMIT 1
  `;
  return root;
}

export async function restoreOperation(sql: postgres.Sql, input: RestoreOperationInput): Promise<RestoreOperationResult> {
  return sql.begin(async (tx) => {
    const preLockRoot = await findOpRoot(tx, input.trashOperationId);
    if (!preLockRoot) return { ok: false, reason: 'not_found' };

    const hasManage = await can(tx, { subjectType: 'user', subjectId: input.actorId, resourceId: preLockRoot.id, action: 'manage' });
    if (!hasManage) return { ok: false, reason: 'not_found' };

    await tx`SELECT id FROM workspaces WHERE id = ${preLockRoot.workspace_id} FOR UPDATE`;

    // Re-resolve under the lock: a concurrent restore/purge could have
    // already consumed this operation between the pre-lock read and here.
    const root = await findOpRoot(tx, input.trashOperationId);
    if (!root) return { ok: false, reason: 'not_found' };

    if (!root.parent_id) {
      // No trashable node type has a null parent_id (the
      // nodes_parent_iff_not_workspace_chk constraint); a workspace root
      // is never trashed by any route. Defensive only.
      throw new Error(`trash operation ${input.trashOperationId}'s root ${root.id} has no parent`);
    }

    const [parent] = await tx<{ trashed_at: Date | null; title: string }[]>`
      SELECT trashed_at, title FROM nodes WHERE id = ${root.parent_id}
    `;
    const parentLive = parent !== undefined && parent.trashed_at === null;

    const targetSlug = input.name !== undefined ? slugifyTitle(input.name) : root.slug;
    const [collision] = parentLive
      ? await tx<{ title: string }[]>`
          SELECT title FROM live_nodes WHERE parent_id = ${root.parent_id} AND slug = ${targetSlug} LIMIT 1
        `
      : [];

    const decision = decideRestore({ parentLive, slugTaken: collision !== undefined, requestedName: input.name });
    if (!decision.ok) {
      if (decision.reason === 'ancestor_trashed') {
        return { ok: false, reason: 'ancestor_trashed', ancestor: { title: parent?.title ?? '' } };
      }
      return { ok: false, reason: 'slug_taken', sibling: { title: collision!.title } };
    }

    if (input.name !== undefined) {
      await tx`UPDATE nodes SET title = ${input.name}, slug = ${targetSlug}, updated_at = now() WHERE id = ${root.id}`;
    }

    // Computed while the root is still trashed, so it is naturally
    // excluded from its own future sibling set — no self-exclusion needed.
    const [positionRow] = await tx<{ next_position: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM live_nodes WHERE parent_id = ${root.parent_id}
    `;
    const nextPosition = positionRow!.next_position;

    // One statement, trigger-safe per design.md Decision 1: restores the
    // root and every row sharing its operation id, regardless of row
    // visit order.
    await tx`
      UPDATE nodes SET trashed_at = NULL, trash_operation_id = NULL, trashed_by = NULL, updated_at = now()
       WHERE trash_operation_id = ${input.trashOperationId}
    `;
    await tx`UPDATE nodes SET position = ${nextPosition}, updated_at = now() WHERE id = ${root.id}`;

    const trashedTrace = await findTrashedTrace(tx, { nodeId: root.id, trashOperationId: input.trashOperationId });
    if (!trashedTrace) {
      throw new Error(`no trashed trace row found for operation ${input.trashOperationId}, node ${root.id}`);
    }

    await appendTrace(tx, {
      workspaceId: root.workspace_id,
      bookId: trashedTrace.bookId,
      nodeId: root.id,
      nodeType: trashedTrace.nodeType,
      title: trashedTrace.title,
      location: trashedTrace.location,
      event: 'restored',
      trashOperationId: input.trashOperationId,
      actorId: input.actorId,
      pageCount: trashedTrace.pageCount,
      restricted: trashedTrace.restricted,
    });

    return { ok: true, nodeId: root.id, parentId: root.parent_id, slug: targetSlug };
  });
}
