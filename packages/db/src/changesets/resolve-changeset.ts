/**
 * Book-scoped changeset resolution (versioning-and-collaboration design.md
 * Decision 3, "The save transaction" / "The changeset race"; changesets
 * spec). Called once per save, inside the same transaction as the
 * `page_content` write, immediately before the `page_revision` insert.
 *
 * `resolveBookId` is the recursive ancestor walk the transaction runs
 * first — a page's owning book, if any — and `resolveChangeset` is the
 * two-statement window-retirement + atomic join-or-open sequence design.md
 * names as "the whole answer" to the concurrent-save race: two saves by
 * the same author, in the same book, on two different pages, share no row
 * lock through `page_content`'s own `FOR UPDATE` (that guard is per page),
 * so the race is closed by `changeset_open_per_author_idx` — a partial
 * unique index on `(workspace_id, book_id, author_id) WHERE closed_at IS
 * NULL` — rather than by lock ordering or a retry loop. The loser of a
 * genuine concurrent insert blocks on that index until the winner commits,
 * then its own `ON CONFLICT ... DO UPDATE` fires and it receives the
 * winner's id.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ResolveBookIdInput {
  readonly nodeId: string;
  readonly workspaceId: string;
}

/**
 * Walks `live_nodes.parent_id` upward from `nodeId` to its nearest `book`
 * ancestor, or `null` when no book ancestor exists (e.g. a page parented
 * directly under the workspace root, which this change does not require
 * every page to avoid — a page with no book ancestor simply never joins a
 * changeset). A trashed `nodeId` resolves to `null` too, identically to an
 * unknown one (trash-non-disclosure spec): the invariant "live implies
 * parent live" (0022_trash.sql's `nodes_trash_guard`) means a live node's
 * whole ancestor chain is always live, so reading through the view changes
 * nothing for this function's one real caller — `insert-revision.ts`,
 * entered only after the route already located the page through
 * `live_nodes`.
 */
export async function resolveBookId(sql: SqlExecutor, input: ResolveBookIdInput): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    WITH RECURSIVE ancestors(id, parent_id, type, depth) AS (
      SELECT id, parent_id, type, 0 FROM live_nodes WHERE id = ${input.nodeId} AND workspace_id = ${input.workspaceId}
      UNION ALL
      SELECT n.id, n.parent_id, n.type, a.depth + 1
        FROM live_nodes n
        JOIN ancestors a ON n.id = a.parent_id
       WHERE n.workspace_id = ${input.workspaceId}
    )
    -- LIMIT 1 over a recursive CTE has no inherent order, so "nearest"
    -- is stated rather than inherited from the evaluation strategy.
    SELECT id FROM ancestors WHERE type = 'book' ORDER BY depth LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export interface ResolveChangesetInput {
  readonly workspaceId: string;
  readonly bookId: string;
  readonly authorId: string;
  readonly windowMinutes: number;
}

/**
 * Joins the author's still-open changeset in this book, opens a new one if
 * none is open or the open one's window lapsed, and returns its id.
 * `closed_at` is set on retirement only — it is never a second copy of
 * `windowMinutes`; whether a changeset is still "open" is always computed
 * from that one constant, exactly as `readLockStatus` computes lock expiry
 * from `PAGE_LOCK_TTL_SECONDS` rather than storing an expiry column.
 */
export async function resolveChangeset(sql: SqlExecutor, input: ResolveChangesetInput): Promise<string> {
  // 1. Retire the open changeset if its window has lapsed. Idempotent —
  //    every concurrent saver computes the same outcome from the same
  //    `last_activity_at`, so running this more than once is harmless.
  await sql`
    UPDATE changeset SET closed_at = last_activity_at
     WHERE workspace_id = ${input.workspaceId} AND book_id = ${input.bookId} AND author_id = ${input.authorId}
       AND closed_at IS NULL
       AND last_activity_at <= now() - (${input.windowMinutes} || ' minutes')::interval
  `;

  // 2. Join the open changeset or open a new one. Atomic: the partial
  //    unique index arbitrates a genuine race, not this statement's own
  //    ordering.
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO changeset (workspace_id, book_id, author_id, last_activity_at)
    VALUES (${input.workspaceId}, ${input.bookId}, ${input.authorId}, now())
    ON CONFLICT (workspace_id, book_id, author_id) WHERE closed_at IS NULL
    DO UPDATE SET last_activity_at = now()
    RETURNING id
  `;
  return row!.id;
}
