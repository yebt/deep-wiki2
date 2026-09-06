/**
 * Read and edit mode read different representations of the same row
 * (docs/SPECS.md §5.3; page-content spec: Read Mode And Edit Mode Read
 * Different Representations). Read mode never invokes the Markdown parser
 * — it is a direct column read of the cache `savePage` already computed.
 */
import type postgres from 'postgres';

export interface PageContentRef {
  readonly nodeId: string;
  readonly workspaceId: string;
}

export interface PageHtml {
  readonly renderedHtml: string;
}

export interface PageMarkdown {
  readonly markdown: string;
}

/** Read mode: cached HTML only. No parser call happens here. */
export async function readPageHtml(sql: postgres.Sql, ref: PageContentRef): Promise<PageHtml | undefined> {
  const [row] = await sql<{ rendered_html: string }[]>`
    SELECT rendered_html FROM page_content WHERE node_id = ${ref.nodeId} AND workspace_id = ${ref.workspaceId}
  `;
  return row ? { renderedHtml: row.rendered_html } : undefined;
}

/** Edit mode: canonical Markdown only. */
export async function readPageMarkdown(sql: postgres.Sql, ref: PageContentRef): Promise<PageMarkdown | undefined> {
  const [row] = await sql<{ markdown: string }[]>`
    SELECT markdown FROM page_content WHERE node_id = ${ref.nodeId} AND workspace_id = ${ref.workspaceId}
  `;
  return row ? { markdown: row.markdown } : undefined;
}
