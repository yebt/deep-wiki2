/**
 * `purgeTrash()` — the 30-day sweep (trash-purge spec; design.md Decision
 * 6, the `embedding_reindex_jobs` idiom applied to purge). One tracked run
 * per workspace: `queued` → `running` → `completed`/`failed`. The run
 * row's own lifecycle lives OUTSIDE the deletion transaction, deliberately
 * — `ai/reindex.ts`'s own header names the reason: a failed statement
 * poisons the rest of a Postgres transaction, so only a clean rollback of
 * the whole attempt is safe to convert into a typed outcome, and a
 * `failed` row must survive that rollback to be worth recording at all.
 *
 * "Eligible" is every node — root or already-co-trashed descendant —
 * whose own `trashed_at` has passed the cutoff, not only the top of a
 * subtree: a descendant trashed separately, long before its later-trashed
 * container, can cross the 30-day line while its container has not, and
 * must be purged on its own. Deletion runs in two bulk passes, pages
 * first: `page_revision_changeset_fk` is not deferrable, so a book's own
 * `changeset` cascade (fired by deleting the book row) would fail while a
 * page_revision row belonging to one of that book's pages still
 * references it. Deleting every eligible page first clears that reference
 * before any container's cascade can reach `changeset` at all. Within
 * each pass, a row already removed by an earlier id's cascade is simply
 * not there anymore — no error.
 *
 * A `purged` trace row is appended only for a node that has one of its own
 * `trashed` trace rows (`findTrashedTrace`) — the operation root that
 * `trashNode()`/`restoreOperation()` actually wrote a row for. A
 * propagated descendant never had its own `trashed` row (its container's
 * single row already carries its `page_count`), so it gets none here
 * either; its disappearance is implied by cascade, not a second trace line.
 */
import { TRASH_RETENTION_DAYS, type NodeType } from '@deep-wiki/core';
import type postgres from 'postgres';
import { appendTrace, findTrashedTrace } from './trace';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface PurgeTrashInput {
  readonly workspaceId: string;
  readonly now?: Date;
}

export interface PurgeTrashResult {
  readonly runId: string;
  readonly purgedNodes: number;
}

interface EligibleRow {
  id: string;
  type: NodeType;
  trash_operation_id: string;
}

export async function purgeTrash(sql: postgres.Sql, input: PurgeTrashInput): Promise<PurgeTrashResult> {
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - TRASH_RETENTION_DAYS * MS_PER_DAY);

  const [run] = await sql<{ id: string }[]>`
    INSERT INTO trash_purge_runs (workspace_id, state, cutoff, started_at)
    VALUES (${input.workspaceId}, 'running', ${cutoff}, now())
    RETURNING id
  `;
  const runId = run!.id;

  try {
    const purgedNodes = await sql.begin(async (tx) => {
      await tx`SELECT id FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE`;

      const eligible = await tx<EligibleRow[]>`
        SELECT id, type, trash_operation_id FROM nodes
         WHERE workspace_id = ${input.workspaceId} AND trashed_at IS NOT NULL AND trashed_at < ${cutoff}
      `;
      if (eligible.length === 0) return 0;

      for (const node of eligible) {
        const trashedTrace = await findTrashedTrace(tx, { nodeId: node.id, trashOperationId: node.trash_operation_id });
        if (!trashedTrace) continue;

        await appendTrace(tx, {
          workspaceId: input.workspaceId,
          bookId: trashedTrace.bookId,
          nodeId: node.id,
          nodeType: trashedTrace.nodeType,
          title: trashedTrace.title,
          location: trashedTrace.location,
          event: 'purged',
          trashOperationId: node.trash_operation_id,
          actorId: null,
          pageCount: trashedTrace.pageCount,
          restricted: trashedTrace.restricted,
        });
      }

      // Pages first: `page_revision.page_revision_changeset_fk` is not
      // deferrable, so a book's `changeset` cascade (fired by deleting the
      // book row below) would fail while a page_revision row belonging to
      // one of the book's own pages still references it. Deleting every
      // eligible page first — which cascades page_content, page_revision,
      // comments and chunks off that page — clears every such reference
      // before any container's cascade can reach `changeset` at all.
      const pageIds = eligible.filter((row) => row.type === 'page').map((row) => row.id);
      const containerIds = eligible.filter((row) => row.type !== 'page').map((row) => row.id);

      let purgedNodes = 0;
      if (pageIds.length > 0) {
        purgedNodes += (await tx<{ id: string }[]>`DELETE FROM nodes WHERE id = ANY(${pageIds}::uuid[]) RETURNING id`).length;
      }
      if (containerIds.length > 0) {
        purgedNodes += (await tx<{ id: string }[]>`DELETE FROM nodes WHERE id = ANY(${containerIds}::uuid[]) RETURNING id`).length;
      }
      return purgedNodes;
    });

    await sql`UPDATE trash_purge_runs SET state = 'completed', purged_nodes = ${purgedNodes}, finished_at = now() WHERE id = ${runId}`;
    return { runId, purgedNodes };
  } catch (error) {
    const errorCode = error instanceof Error ? error.message.slice(0, 200) : 'unknown_error';
    await sql`UPDATE trash_purge_runs SET state = 'failed', finished_at = now(), error_code = ${errorCode} WHERE id = ${runId}`;
    throw error;
  }
}
