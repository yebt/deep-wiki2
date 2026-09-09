/**
 * Batched, resumable, `content_hash`-guarded re-render (comment-overlay
 * spec: "A Render-Format Change Requires A Backfill"; versioning-and-
 * collaboration design.md Decision 6, "Staleness detection and backfill").
 * Not a migration: `render()` is TypeScript, and a `.sql` migration
 * cannot call it. Idempotent and safe to re-run — a row already at
 * `CURRENT_PIPELINE_VERSION` never matches the staleness filter again, so
 * resuming after an interruption is simply running this again.
 */
import { CURRENT_PIPELINE_VERSION, render } from '@deep-wiki/markdown';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

const DEFAULT_BATCH_SIZE = 200;

export interface BackfillOneRowInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  /** The markdown the caller's own read observed — re-rendered fresh, never trusted as still current. */
  readonly markdown: string;
  /** The `content_hash` the caller's own read observed, used as the concurrency guard. */
  readonly expectedContentHash: string;
}

export type BackfillOneRowOutcome = 'updated' | 'skipped';

/**
 * Re-renders one row and writes it back guarded by `content_hash`: a row
 * whose content changed since it was read (a real, concurrent user save)
 * no longer matches the guard, so the stale render this function computed
 * is discarded rather than clobbering the newer save.
 */
export async function backfillOneRow(sql: SqlExecutor, input: BackfillOneRowInput): Promise<BackfillOneRowOutcome> {
  const renderedHtml = render(input.markdown);

  const rows = await sql`
    UPDATE page_content
       SET rendered_html = ${renderedHtml}, pipeline_version = ${CURRENT_PIPELINE_VERSION}
     WHERE node_id = ${input.nodeId}
       AND workspace_id = ${input.workspaceId}
       AND content_hash = ${input.expectedContentHash}
    RETURNING node_id
  `;

  return rows.length > 0 ? 'updated' : 'skipped';
}

export interface BackfillRenderOptions {
  readonly batchSize?: number;
}

export interface BackfillRenderResult {
  readonly updated: number;
  readonly skipped: number;
}

interface StaleRow {
  node_id: string;
  workspace_id: string;
  markdown: string;
  content_hash: string;
}

/**
 * Re-renders every `page_content` row whose `pipeline_version` predates
 * `CURRENT_PIPELINE_VERSION`, in batches of `batchSize` (default 200).
 * `pipeline_version` — not `content_hash` — is the staleness signal: the
 * Markdown did not change, the pipeline did, and `content_hash` alone
 * would report every row as already fresh.
 */
export async function backfillRender(sql: SqlExecutor, options: BackfillRenderOptions = {}): Promise<BackfillRenderResult> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  let updated = 0;
  let skipped = 0;

  for (;;) {
    const rows = await sql<StaleRow[]>`
      SELECT node_id, workspace_id, markdown, content_hash FROM page_content
       WHERE pipeline_version < ${CURRENT_PIPELINE_VERSION}
       ORDER BY node_id
       LIMIT ${batchSize}
    `;
    if (rows.length === 0) break;

    for (const row of rows) {
      const outcome = await backfillOneRow(sql, {
        nodeId: row.node_id,
        workspaceId: row.workspace_id,
        markdown: row.markdown,
        expectedContentHash: row.content_hash,
      });
      if (outcome === 'updated') updated++;
      else skipped++;
    }
  }

  return { updated, skipped };
}
