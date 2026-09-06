/**
 * The page save transaction (content-and-editor design.md "The save
 * transaction", page-content spec). Assert canonical -> compute the
 * derived render and block index from the new content only -> write, guarded
 * by `content_hash` optimistic concurrency (D16). `rendered_html` and
 * `block_index` have no place in this function's own input type: they are
 * always regenerated from `markdown`, never accepted from the caller.
 *
 * Block reconciliation via `matchBlocks` against `page_blocks` is a later
 * phase (WU-9) — this function writes `page_content` only.
 */
import { createHash } from 'node:crypto';
import { buildBlockIndex, canonicalise, parse, render, type BlockIndex } from '@deep-wiki/markdown';
import type postgres from 'postgres';

export class NotCanonicalError extends Error {
  constructor(readonly canonical: string) {
    super('markdown is not in its own canonical form; normalise before saving');
    this.name = 'NotCanonicalError';
  }
}

export class StaleContentError extends Error {
  constructor(nodeId: string) {
    super(`page ${nodeId} was not saved: expectedContentHash did not match the current row`);
    this.name = 'StaleContentError';
  }
}

export interface SavePageInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly markdown: string;
  /** `null` for the first save; otherwise the `contentHash` last read. */
  readonly expectedContentHash: string | null;
  readonly updatedBy?: string;
}

export interface SavePageResult {
  readonly contentHash: string;
  readonly renderedHtml: string;
  readonly blockIndex: BlockIndex;
}

function contentHashOf(markdown: string): string {
  return createHash('sha256').update(markdown).digest('hex');
}

export async function savePage(sql: postgres.Sql, input: SavePageInput): Promise<SavePageResult> {
  const canonical = canonicalise(input.markdown);
  if (canonical !== input.markdown) {
    throw new NotCanonicalError(canonical);
  }

  const contentHash = contentHashOf(canonical);
  const renderedHtml = render(canonical);
  const blockIndex = buildBlockIndex(parse(canonical), canonical);

  return sql.begin(async (tx) => {
    if (input.expectedContentHash === null) {
      const rows = await tx`
        INSERT INTO page_content (node_id, workspace_id, markdown, rendered_html, block_index, content_hash, updated_by)
        VALUES (
          ${input.nodeId}, ${input.workspaceId}, ${canonical}, ${renderedHtml},
          ${tx.json(JSON.parse(JSON.stringify(blockIndex)))}, ${contentHash}, ${input.updatedBy ?? null}
        )
        ON CONFLICT (node_id) DO NOTHING
        RETURNING node_id
      `;
      if (rows.length === 0) throw new StaleContentError(input.nodeId);
    } else {
      const rows = await tx`
        UPDATE page_content
           SET markdown = ${canonical},
               rendered_html = ${renderedHtml},
               block_index = ${tx.json(JSON.parse(JSON.stringify(blockIndex)))},
               content_hash = ${contentHash},
               updated_by = ${input.updatedBy ?? null},
               updated_at = now()
         WHERE node_id = ${input.nodeId}
           AND workspace_id = ${input.workspaceId}
           AND content_hash = ${input.expectedContentHash}
        RETURNING node_id
      `;
      if (rows.length === 0) throw new StaleContentError(input.nodeId);
    }

    return { contentHash, renderedHtml, blockIndex };
  });
}
