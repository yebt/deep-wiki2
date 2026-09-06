/**
 * Reconciles a page's derived rows — `links`, `tags`/`page_tags`, and
 * `page_blocks` — from its freshly parsed canonical Markdown, replacing
 * `links` and `page_tags` wholesale and reconciling `page_blocks` via
 * `matchBlocks` (design.md "The save transaction"; knowledge-graph spec:
 * Links Are Rebuilt, Not Patched, On Every Save; Tags And Page-Tag
 * Associations Are Rebuilt On Save).
 *
 * Nothing here writes `page_content` itself — `save-page.ts` owns that row
 * and calls `reconcileDerived` inside the same transaction, so a failure
 * here rolls back the content write too. This is also the only module
 * outside `packages/db/src/content/` permitted to write `links`/`page_tags`
 * (`scripts/checks/query-boundaries.ts`).
 */
import {
  collectTags,
  collectWikiLinks,
  matchBlocks,
  sliceBlocks,
  parse,
  type BlockSlice,
  type PersistedBlockRecord,
} from '@deep-wiki/markdown';
import { createHash } from 'node:crypto';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;
/** `packages/markdown` does not export the mdast `Root` type itself — this
 * package has no direct dependency on `mdast`, so the alias is derived from
 * `parse()`'s own return type rather than importing it. */
type Root = ReturnType<typeof parse>;

export interface ReconcileDerivedInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  /** Already parsed from `canonicalMarkdown` — reused so this never re-parses what the caller just parsed. */
  readonly tree: Root;
  readonly canonicalMarkdown: string;
  /** The page's markdown before this save, or `null` on the very first save. */
  readonly previousMarkdown: string | null;
}

function excerptHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function excerptOf(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > 140 ? `${trimmed.slice(0, 140)}…` : trimmed;
}

async function resolvePageIdsByTitle(
  tx: SqlExecutor,
  workspaceId: string,
  titles: readonly string[],
): Promise<Map<string, string>> {
  if (titles.length === 0) return new Map();

  const rows = await tx<{ id: string; title: string }[]>`
    SELECT id, title FROM nodes WHERE workspace_id = ${workspaceId} AND type = 'page' AND title = ANY(${titles})
  `;
  return new Map(rows.map((row) => [row.title, row.id]));
}

async function replaceLinks(tx: SqlExecutor, nodeId: string, workspaceId: string, tree: Root): Promise<void> {
  const wikiLinks = collectWikiLinks(tree);
  const titles = [...new Set(wikiLinks.map((link) => link.target))];
  const resolvedByTitle = await resolvePageIdsByTitle(tx, workspaceId, titles);

  await tx`DELETE FROM links WHERE source_page_id = ${nodeId} AND workspace_id = ${workspaceId}`;

  for (const link of wikiLinks) {
    await tx`
      INSERT INTO links (workspace_id, source_page_id, target_page_id, target_raw, source_block_id, anchor)
      VALUES (
        ${workspaceId}, ${nodeId}, ${resolvedByTitle.get(link.target) ?? null},
        ${link.target}, ${link.sourceBlockId}, ${link.anchor ?? null}
      )
    `;
  }
}

async function replaceTags(tx: SqlExecutor, nodeId: string, workspaceId: string, tree: Root): Promise<void> {
  const tagNames = collectTags(tree);

  await tx`DELETE FROM page_tags WHERE page_id = ${nodeId} AND workspace_id = ${workspaceId}`;

  for (const name of tagNames) {
    const [tag] = await tx<{ id: string }[]>`
      INSERT INTO tags (workspace_id, name) VALUES (${workspaceId}, ${name})
      ON CONFLICT (workspace_id, name) DO UPDATE SET name = EXCLUDED.name
      RETURNING id
    `;
    await tx`
      INSERT INTO page_tags (page_id, tag_id, workspace_id) VALUES (${nodeId}, ${tag!.id}, ${workspaceId})
      ON CONFLICT DO NOTHING
    `;
  }
}

async function upsertActiveBlock(tx: SqlExecutor, nodeId: string, workspaceId: string, blockId: string, text: string): Promise<void> {
  await tx`
    INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
    VALUES (${nodeId}, ${workspaceId}, ${blockId}, 'active', ${excerptHashOf(text)}, ${excerptOf(text)})
    ON CONFLICT (page_id, block_id) DO UPDATE SET
      status = 'active', superseded_by = NULL, content_hash = EXCLUDED.content_hash,
      excerpt = EXCLUDED.excerpt, updated_at = now()
  `;
}

/**
 * Reconciles `page_blocks` via `matchBlocks` (design.md "Block identity").
 * `matchBlocks`' own threshold algorithm is unit-tested against generated
 * edit sequences in `packages/markdown/src/match-blocks.test.ts` — this
 * function only wires it to the persisted registry.
 */
async function reconcileBlocks(
  tx: SqlExecutor,
  nodeId: string,
  workspaceId: string,
  tree: Root,
  canonicalMarkdown: string,
  previousMarkdown: string | null,
): Promise<void> {
  const nextBlocks: BlockSlice[] = sliceBlocks(tree, canonicalMarkdown);
  const nextTexts = nextBlocks.map((block) => block.text);

  const existingActive = await tx<{ block_id: string }[]>`
    SELECT block_id FROM page_blocks WHERE page_id = ${nodeId} AND workspace_id = ${workspaceId} AND status = 'active'
  `;
  const existingActiveIds = new Set(existingActive.map((row) => row.block_id));

  let previousRecords: PersistedBlockRecord[] = [];
  if (previousMarkdown !== null && existingActiveIds.size > 0) {
    const previousBlocks = sliceBlocks(parse(previousMarkdown), previousMarkdown);
    const textByAnchor = new Map(
      previousBlocks.filter((block): block is BlockSlice & { anchorId: string } => block.anchorId !== null).map((block) => [block.anchorId, block.text]),
    );
    previousRecords = [...existingActiveIds]
      .filter((id) => textByAnchor.has(id))
      .map((id) => ({ id, text: textByAnchor.get(id)! }));
  }

  const { assignments, mintedIds } = matchBlocks(previousRecords, nextTexts);
  const handledIds = new Set<string>();

  for (const assignment of assignments) {
    handledIds.add(assignment.id);
    if (assignment.status === 'active') {
      await upsertActiveBlock(tx, nodeId, workspaceId, assignment.id, nextTexts[assignment.slot!]!);
    } else if (assignment.status === 'superseded') {
      await tx`
        UPDATE page_blocks SET status = 'superseded', superseded_by = ${assignment.supersededBy!}, updated_at = now()
         WHERE page_id = ${nodeId} AND block_id = ${assignment.id}
      `;
    } else {
      await tx`
        UPDATE page_blocks SET status = 'tombstoned', updated_at = now()
         WHERE page_id = ${nodeId} AND block_id = ${assignment.id}
      `;
    }
  }

  for (const minted of mintedIds) {
    handledIds.add(minted.id);
    await upsertActiveBlock(tx, nodeId, workspaceId, minted.id, nextTexts[minted.slot]!);
  }

  // First-time registration: an anchor can arrive already written into the
  // Markdown (imported content, or authored directly) with no prior
  // page_blocks row at all — `matchBlocks` has nothing to match it against,
  // so it is registered active on the save that first sees it (design D7).
  for (const block of nextBlocks) {
    if (!block.anchorId) continue;
    if (existingActiveIds.has(block.anchorId) || handledIds.has(block.anchorId)) continue;
    await upsertActiveBlock(tx, nodeId, workspaceId, block.anchorId, block.text);
  }
}

export async function reconcileDerived(tx: SqlExecutor, input: ReconcileDerivedInput): Promise<void> {
  await replaceLinks(tx, input.nodeId, input.workspaceId, input.tree);
  await replaceTags(tx, input.nodeId, input.workspaceId, input.tree);
  await reconcileBlocks(tx, input.nodeId, input.workspaceId, input.tree, input.canonicalMarkdown, input.previousMarkdown);
}
