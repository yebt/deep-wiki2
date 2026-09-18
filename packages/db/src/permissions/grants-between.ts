/**
 * The `restricted` snapshot for a deletion trace (deletion-trace spec —
 * "A Restricted Trace Discloses Only That A Page Was Deleted To A Subject
 * Who Could Not Have Read It"; design.md Decision 5). A node's readability
 * *was* its book's by construction unless some node strictly between the
 * book and the operation's own ids carries its own grant row — in which
 * case that grant may be narrower than the book's, and the trace must not
 * assume every book reader could read the deleted node.
 *
 * One `EXISTS` over `permissions`, scoped by workspace for
 * `permissions_lookup_idx`; `scripts/checks/query-boundaries.ts` already
 * confines every `permissions` table reference to this directory, so this
 * is a sibling of `queries.ts`/`can-many.ts`, not a new read path.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface HasGrantsBetweenInput {
  readonly workspaceId: string;
  /** `null` when the operation's root has no book ancestor (a shelf); every id is then "below the book" by construction. */
  readonly bookId: string | null;
  /** The operation's own ids (the trashed root and every co-trashed descendant). The book's own id, if present here, is excluded — a grant on the book itself is not "narrower than the book's". */
  readonly nodeIds: readonly string[];
}

export async function hasGrantsBetween(sql: SqlExecutor, input: HasGrantsBetweenInput): Promise<boolean> {
  const belowBook = input.nodeIds.filter((id) => id !== input.bookId);
  if (belowBook.length === 0) return false;

  const [row] = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM permissions
       WHERE workspace_id = ${input.workspaceId}
         AND resource_id = ANY(${belowBook}::uuid[])
    ) AS "exists"
  `;
  return row!.exists;
}
