/**
 * Book-level changeset history (changesets spec: "Book-Level History Is One
 * Query" — the input the book-level diff screen needs). One SQL statement
 * returns every changeset for the book together with the revisions it
 * groups — not one query per page, and not one query per changeset.
 *
 * `resolveBookId`'s ancestor walk at *save* time already scoped every
 * changeset's `book_id` to the nearest book ancestor (`resolve-changeset.ts`),
 * so a page nested arbitrarily deep under a chapter still surfaces here
 * through the ordinary `changeset.book_id = <this book>` predicate — no
 * extra ancestor walk is needed at read time.
 *
 * Per-page non-disclosure by explicit grant (a reader who can read the book
 * but not one page in it must not see that page's revisions) is
 * deliberately not this function's job: it returns every revision in the
 * book's live changesets, and `apps/api/src/routes/revisions.ts` filters by
 * `readableResourceIds` before shaping the response — the same split
 * `book-diff.ts` already uses for its own book-level route. Trash is the
 * one exclusion this function *does* own: the `live_nodes` join drops a
 * trashed page's revisions from every changeset (changesets spec — "A
 * trashed page's revisions are excluded for a non-manager"), while a
 * changeset's other, still-live pages keep appearing.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ChangesetRevisionRow {
  readonly id: string;
  readonly pageId: string;
  readonly createdAt: Date;
}

export interface BookChangeset {
  readonly id: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  /** No code path writes this column yet (changesets spec: "Changeset Carries An Optional Message") — always `null` today. */
  readonly message: string | null;
  readonly windowStart: Date;
  readonly windowEnd: Date;
  readonly revisions: readonly ChangesetRevisionRow[];
}

export interface ListBookHistoryInput {
  readonly bookId: string;
  readonly workspaceId: string;
}

interface Row {
  changeset_id: string;
  author_id: string | null;
  author_display_name: string | null;
  message: string | null;
  revision_id: string;
  page_id: string;
  revision_created_at: Date;
}

/**
 * Newest first, where "newest" is a changeset's own most recent revision.
 * Rows arrive ordered `revision_created_at DESC`, so the first row this
 * function sees for any given changeset is necessarily that changeset's
 * newest revision — first-appearance order while folding therefore *is*
 * "changeset ordered by its own latest activity, descending", with no
 * separate `ORDER BY` on the changeset itself required.
 */
export async function listBookHistory(sql: SqlExecutor, input: ListBookHistoryInput): Promise<BookChangeset[]> {
  const rows = await sql<Row[]>`
    SELECT c.id AS changeset_id, c.author_id, u.display_name AS author_display_name, c.message,
           r.id AS revision_id, r.page_id, r.created_at AS revision_created_at
      FROM changeset c
      JOIN page_revision r ON r.changeset_id = c.id AND r.workspace_id = c.workspace_id
      JOIN live_nodes ln ON ln.id = r.page_id
      LEFT JOIN users u ON u.id = c.author_id
     WHERE c.workspace_id = ${input.workspaceId} AND c.book_id = ${input.bookId}
     ORDER BY r.created_at DESC
  `;

  const order: string[] = [];
  const meta = new Map<string, Row>();
  const revisionsByChangeset = new Map<string, ChangesetRevisionRow[]>();

  for (const row of rows) {
    if (!meta.has(row.changeset_id)) {
      meta.set(row.changeset_id, row);
      order.push(row.changeset_id);
      revisionsByChangeset.set(row.changeset_id, []);
    }
    revisionsByChangeset.get(row.changeset_id)!.push({
      id: row.revision_id,
      pageId: row.page_id,
      createdAt: row.revision_created_at,
    });
  }

  return order.map((changesetId) => {
    const row = meta.get(changesetId)!;
    const revisions = revisionsByChangeset.get(changesetId)!.slice().sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const timestamps = revisions.map((revision) => revision.createdAt.getTime());
    return {
      id: changesetId,
      authorId: row.author_id,
      authorDisplayName: row.author_display_name,
      message: row.message,
      windowStart: new Date(Math.min(...timestamps)),
      windowEnd: new Date(Math.max(...timestamps)),
      revisions,
    };
  });
}
