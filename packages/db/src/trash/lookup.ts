/**
 * `trashLookup()` — the manage-gated single-node lookup design.md Decision
 * 7 wires into `GET /trash/nodes/:id` and, after a `live_nodes` miss, into
 * `GET /pages/:id`'s own trash block. Reading the base table on purpose:
 * "How `manage` holders see trashed rows" (design.md Decision 2) names
 * this function as one of the two places that may.
 */
import { daysUntilPurge } from '@deep-wiki/core';
import type postgres from 'postgres';
import { can } from '../permissions/queries';
import { computeRestoreBlockedBy, fetchDisplayName } from './listing';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface TrashLookupInput {
  readonly nodeId: string;
  readonly subjectId: string;
  readonly now?: Date;
}

export interface TrashLookupResult {
  readonly operationId: string;
  readonly trashedAt: Date;
  readonly trashedBy: { readonly id: string; readonly displayName: string } | null;
  readonly daysLeft: number;
  readonly restoreBlockedBy: { readonly title: string } | null;
  /** The trashed node's own identity — `apps/api/src/routes/pages.ts`'s only way to answer `GET /pages/:id` after a `live_nodes` miss without a second base-table read of its own. */
  readonly title: string;
  readonly workspaceId: string;
  readonly workspaceSlug: string;
}

interface TrashedNodeRow {
  parent_id: string | null;
  slug: string;
  trash_operation_id: string;
  trashed_at: Date;
  trashed_by: string | null;
  title: string;
  workspace_id: string;
  workspace_slug: string;
}

/** `null` unless the node is trashed AND the subject may `manage` it — a non-manager and a nonexistent node get the same `null`. */
export async function trashLookup(sql: SqlExecutor, input: TrashLookupInput): Promise<TrashLookupResult | null> {
  const [node] = await sql<TrashedNodeRow[]>`
    SELECT n.parent_id, n.slug, n.trash_operation_id, n.trashed_at, n.trashed_by, n.title, n.workspace_id, w.slug AS workspace_slug
      FROM nodes n JOIN workspaces w ON w.id = n.workspace_id
     WHERE n.id = ${input.nodeId} AND n.trashed_at IS NOT NULL
  `;
  if (!node) return null;

  const hasManage = await can(sql, { subjectType: 'user', subjectId: input.subjectId, resourceId: input.nodeId, action: 'manage' });
  if (!hasManage) return null;

  const [trashedBy, restoreBlockedBy] = await Promise.all([
    node.trashed_by ? fetchDisplayName(sql, node.trashed_by) : Promise.resolve(null),
    computeRestoreBlockedBy(sql, { parentId: node.parent_id, slug: node.slug }),
  ]);

  return {
    operationId: node.trash_operation_id,
    trashedAt: node.trashed_at,
    trashedBy,
    daysLeft: daysUntilPurge(node.trashed_at, input.now ?? new Date()),
    restoreBlockedBy,
    title: node.title,
    workspaceId: node.workspace_id,
    workspaceSlug: node.workspace_slug,
  };
}
