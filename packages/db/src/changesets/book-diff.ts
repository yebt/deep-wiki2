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
 *
 * Three queries total regardless of how many pages changed — the touched-page
 * list, then one `DISTINCT ON` batch each for "the baseline per page" and
 * "the latest per page" — rather than the two-per-page loop this replaced
 * (an N+1 recorded by the audit referenced in the versioning-and-collaboration
 * design doc's book-diff section).
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
  // live_nodes: a trashed page's revisions never surface in the book-level
  // diff (trash-non-disclosure spec names "diff" as a read surface), though
  // other pages in the same book still do.
  const touchedPages = await sql<{ page_id: string }[]>`
    SELECT DISTINCT pr.page_id
      FROM page_revision pr
      JOIN changeset c ON c.id = pr.changeset_id AND c.workspace_id = pr.workspace_id
      JOIN live_nodes ln ON ln.id = pr.page_id
     WHERE pr.workspace_id = ${input.workspaceId}
       AND c.book_id = ${input.bookId}
       AND pr.created_at > ${input.since}
  `;
  if (touchedPages.length === 0) return [];
  const pageIds = touchedPages.map((row) => row.page_id);

  // "The revision immediately preceding `since`, per page" and "the most
  // recent revision, per page" are each exactly one row per page — a
  // `DISTINCT ON (page_id)` batch answers both in one statement apiece,
  // for every touched page at once.
  const [baselines, latests] = await Promise.all([
    sql<{ page_id: string; id: string }[]>`
      SELECT DISTINCT ON (page_id) page_id, id
        FROM page_revision
       WHERE workspace_id = ${input.workspaceId} AND page_id = ANY(${pageIds}) AND created_at <= ${input.since}
       ORDER BY page_id, created_at DESC
    `,
    sql<{ page_id: string; id: string }[]>`
      SELECT DISTINCT ON (page_id) page_id, id
        FROM page_revision
       WHERE workspace_id = ${input.workspaceId} AND page_id = ANY(${pageIds})
       ORDER BY page_id, created_at DESC
    `,
  ]);

  const baselineByPage = new Map(baselines.map((row) => [row.page_id, row.id]));
  const latestByPage = new Map(latests.map((row) => [row.page_id, row.id]));

  return pageIds.map((pageId) => ({
    pageId,
    baselineRevisionId: baselineByPage.get(pageId) ?? null,
    latestRevisionId: latestByPage.get(pageId)!,
  }));
}
