/**
 * `readTrashedPageHtml()` — the one place a trashed page's rendered HTML is
 * read from the base `page_content` table on purpose (page-content spec
 * delta: "A manager can still read a trashed page's content";
 * trash-non-disclosure spec — "How `manage` holders see trashed rows" names
 * this directory as the exception). `read-page.ts`'s `readPageHtml` always
 * joins `live_page_content`, so it can never answer this scenario — a
 * trashed row is definitionally absent from that view for everyone,
 * manager included.
 *
 * Callable only after the caller (`apps/api/src/routes/pages.ts`) has
 * already confirmed the node is trashed and the subject may `manage` it
 * through `trashLookup()`; this function performs no permission check of
 * its own, exactly as `ancestorTitles()`/`fetchDisplayName()` in this same
 * directory don't.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ReadTrashedPageHtmlInput {
  readonly nodeId: string;
  readonly workspaceId: string;
}

export async function readTrashedPageHtml(sql: SqlExecutor, input: ReadTrashedPageHtmlInput): Promise<{ renderedHtml: string } | undefined> {
  const [row] = await sql<{ rendered_html: string }[]>`
    SELECT rendered_html FROM page_content WHERE node_id = ${input.nodeId} AND workspace_id = ${input.workspaceId}
  `;
  return row ? { renderedHtml: row.rendered_html } : undefined;
}
