/**
 * The Trash listing — `GET /workspaces/:ref/trash` (trash-restore spec;
 * design.md Decision 7's `TrashListingResponseSchema`). Built entirely on
 * `manageableTrashRoots()` (trash-restore spec — "Trash Listing Shows Only
 * What The Subject May Manage"): a subject with no `manage` grant anywhere
 * sees an empty list, indistinguishable from an empty trash.
 */
import { daysUntilPurge, type NodeType, type SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';
import { manageableTrashRoots } from '../permissions/manageable-trash';
import { ancestorTitles } from './trash-node';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface TrashListingItem {
  readonly operationId: string;
  readonly root: { readonly id: string; readonly type: NodeType; readonly title: string };
  readonly location: readonly string[];
  readonly trashedBy: { readonly id: string; readonly displayName: string } | null;
  readonly trashedAt: Date;
  readonly purgeAt: Date;
  readonly daysLeft: number;
  readonly pages: number;
  readonly containers: number;
  readonly restoreBlockedBy: { readonly title: string } | null;
}

export interface ListManageableTrashInput {
  readonly workspaceId: string;
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
  readonly now?: Date;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const TRASH_RETENTION_MS = 30 * MS_PER_DAY;

export async function fetchDisplayName(sql: SqlExecutor, userId: string): Promise<{ id: string; displayName: string } | null> {
  const [row] = await sql<{ display_name: string }[]>`SELECT display_name FROM users WHERE id = ${userId}`;
  return row ? { id: userId, displayName: row.display_name } : null;
}

async function countOperationCounts(sql: SqlExecutor, trashOperationId: string, rootId: string): Promise<{ pages: number; containers: number }> {
  const rows = await sql<{ type: NodeType; count: number }[]>`
    SELECT type, COUNT(*)::int AS count FROM nodes WHERE trash_operation_id = ${trashOperationId} AND id <> ${rootId} GROUP BY type
  `;
  const pages = rows.find((row) => row.type === 'page')?.count ?? 0;
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { pages, containers: total - pages };
}

/** Ancestor trashed, or a live sibling holds the slug — the same two reasons `restoreOperation()` refuses for (trash-restore spec). */
export async function computeRestoreBlockedBy(
  sql: SqlExecutor,
  root: { readonly parentId: string | null; readonly slug: string },
): Promise<{ title: string } | null> {
  if (!root.parentId) return null;
  const [parent] = await sql<{ trashed_at: Date | null; title: string }[]>`SELECT trashed_at, title FROM nodes WHERE id = ${root.parentId}`;
  if (!parent || parent.trashed_at !== null) return { title: parent?.title ?? '' };

  const [collision] = await sql<{ title: string }[]>`
    SELECT title FROM live_nodes WHERE parent_id = ${root.parentId} AND slug = ${root.slug} LIMIT 1
  `;
  return collision ? { title: collision.title } : null;
}

export async function listManageableTrash(sql: SqlExecutor, input: ListManageableTrashInput): Promise<readonly TrashListingItem[]> {
  const roots = await manageableTrashRoots(sql, {
    workspaceId: input.workspaceId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });
  if (roots.length === 0) return [];

  const now = input.now ?? new Date();

  return Promise.all(
    roots.map(async (root) => {
      const [location, trashedBy, counts, restoreBlockedBy] = await Promise.all([
        ancestorTitles(sql, { parentId: root.parentId }),
        root.trashedBy ? fetchDisplayName(sql, root.trashedBy) : Promise.resolve(null),
        countOperationCounts(sql, root.trashOperationId, root.id),
        computeRestoreBlockedBy(sql, root),
      ]);

      return {
        operationId: root.trashOperationId,
        root: { id: root.id, type: root.type, title: root.title },
        location,
        trashedBy,
        trashedAt: root.trashedAt,
        purgeAt: new Date(root.trashedAt.getTime() + TRASH_RETENTION_MS),
        daysLeft: daysUntilPurge(root.trashedAt, now),
        pages: counts.pages,
        containers: counts.containers,
        restoreBlockedBy,
      };
    }),
  );
}
