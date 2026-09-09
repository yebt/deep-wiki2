/**
 * Book-level "what changed since <date>" aggregation (block-diff spec:
 * "Book-Level Diff Aggregates Changed Pages Since A Date"). Computed
 * entirely from `page_revision.changeset_id` joined to `changeset.book_id`
 * — never from a second, independent change log.
 *
 * For each page touched by one of this book's changesets after `since`,
 * the caller (the diff route) diffs `baselineRevisionId` (the revision
 * immediately preceding `since`, or `null` when the page has none) against
 * `latestRevisionId` (that page's most recent revision) — "each page's
 * page-level diff since the revision immediately preceding that date."
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ChangedPageSummary {
  readonly pageId: string;
  readonly baselineRevisionId: string | null;
  readonly latestRevisionId: string;
}

export interface ListChangedPagesSinceInput {
  readonly workspaceId: string;
  readonly bookId: string;
  readonly since: Date;
}

export async function listChangedPagesSince(
  sql: SqlExecutor,
  input: ListChangedPagesSinceInput,
): Promise<ChangedPageSummary[]> {
  const touchedPages = await sql<{ page_id: string }[]>`
    SELECT DISTINCT pr.page_id
      FROM page_revision pr
      JOIN changeset c ON c.id = pr.changeset_id AND c.workspace_id = pr.workspace_id
     WHERE pr.workspace_id = ${input.workspaceId}
       AND c.book_id = ${input.bookId}
       AND pr.created_at > ${input.since}
  `;

  const results: ChangedPageSummary[] = [];
  // One book-level diff request touches a handful of changed pages at
  // most (the scale this feature targets — see design.md Decision 7,
  // "Numbers, not adjectives"); a per-page baseline/latest lookup here
  // trades a few extra indexed queries for a query that stays readable as
  // a plain "immediately preceding" / "most recent" pair.
  for (const row of touchedPages) {
    const [baseline] = await sql<{ id: string }[]>`
      SELECT id FROM page_revision
       WHERE page_id = ${row.page_id} AND workspace_id = ${input.workspaceId} AND created_at <= ${input.since}
       ORDER BY created_at DESC
       LIMIT 1
    `;
    const [latest] = await sql<{ id: string }[]>`
      SELECT id FROM page_revision
       WHERE page_id = ${row.page_id} AND workspace_id = ${input.workspaceId}
       ORDER BY created_at DESC
       LIMIT 1
    `;
    results.push({ pageId: row.page_id, baselineRevisionId: baseline?.id ?? null, latestRevisionId: latest!.id });
  }
  return results;
}
