/**
 * The Trash listing's own query: which trashed operation roots a subject
 * may `manage` (trash-restore spec — "Trash Listing Shows Only What The
 * Subject May Manage"). A first-class query, not a filtered read list — a
 * subject with no `manage` grant anywhere sees an empty listing,
 * indistinguishable from an empty trash.
 *
 * `scripts/checks/query-boundaries.ts` confines every `permissions` table
 * reference to this directory; the base-table `nodes` read here is
 * exempted by `scripts/checks/trash-filter.ts`'s `packages/db/src/permissions/`
 * entry — the resolver must walk trashed rows so `manage` on one still
 * resolves.
 */
import type { NodeType, SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';
import { canManyResources } from './can-many';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface TrashRoot {
  readonly id: string;
  readonly type: NodeType;
  readonly title: string;
  readonly slug: string;
  readonly parentId: string | null;
  readonly trashOperationId: string;
  readonly trashedAt: Date;
  readonly trashedBy: string | null;
}

export interface ManageableTrashRootsInput {
  readonly workspaceId: string;
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
}

/**
 * A row is the root of its own trash operation when its parent is either
 * absent, live, or trashed under a *different* operation — the same
 * "op root" shape `restoreOperation()` locates for a single known
 * operation id, generalised here across the whole workspace.
 */
export async function manageableTrashRoots(sql: SqlExecutor, input: ManageableTrashRootsInput): Promise<readonly TrashRoot[]> {
  const roots = await sql<
    {
      id: string;
      type: NodeType;
      title: string;
      slug: string;
      parent_id: string | null;
      trash_operation_id: string;
      trashed_at: Date;
      trashed_by: string | null;
    }[]
  >`
    SELECT n.id, n.type, n.title, n.slug, n.parent_id, n.trash_operation_id, n.trashed_at, n.trashed_by
      FROM nodes n
      LEFT JOIN nodes p ON p.id = n.parent_id
     WHERE n.workspace_id = ${input.workspaceId}
       AND n.trashed_at IS NOT NULL
       AND (p.id IS NULL OR p.trashed_at IS NULL OR p.trash_operation_id IS DISTINCT FROM n.trash_operation_id)
  `;

  if (roots.length === 0) return [];

  const manageable = await canManyResources(sql, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    action: 'manage',
    resourceIds: roots.map((row) => row.id),
  });

  return roots
    .filter((row) => manageable.has(row.id))
    .map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      slug: row.slug,
      parentId: row.parent_id,
      trashOperationId: row.trash_operation_id,
      trashedAt: row.trashed_at,
      trashedBy: row.trashed_by,
    }));
}
