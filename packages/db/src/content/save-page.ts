/**
 * The page save transaction (content-and-editor design.md "The save
 * transaction", page-content spec). Assert canonical -> compute the
 * derived render and block index from the new content only -> write, guarded
 * by `content_hash` optimistic concurrency (D16) -> reconcile the derived
 * knowledge graph and block registry (`reconcileDerived`) in the same
 * transaction, so a failure there rolls back the content write too.
 * `rendered_html` and `block_index` have no place in this function's own
 * input type: they are always regenerated from `markdown`, never accepted
 * from the caller.
 */
import { createHash } from 'node:crypto';
import { buildBlockIndex, canonicalise, CURRENT_PIPELINE_VERSION, parse, render, type BlockIndex } from '@deep-wiki/markdown';
import type postgres from 'postgres';
import { writeRevision } from '../revisions/insert-revision';
import { reconcileDerived } from './rebuild-derived';

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

/**
 * page-content spec: "Read of a trashed page's content is denied like
 * absence" applies to saving too — a trashed page (or one that never
 * existed at all) must be denied identically, before the write transaction
 * ever opens (trash-non-disclosure spec). `live_nodes` is the one check
 * that answers both cases the same way: a trashed node and an unknown one
 * are both simply absent from it.
 */
export class PageNotFoundError extends Error {
  constructor(nodeId: string) {
    super(`page ${nodeId} does not exist`);
    this.name = 'PageNotFoundError';
  }
}

export interface SavePageInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly markdown: string;
  /** `null` for the first save; otherwise the `contentHash` last read. */
  readonly expectedContentHash: string | null;
  readonly updatedBy?: string;
  /**
   * `CHANGESET_WINDOW_MINUTES` (design.md Decision 4), threaded in by the
   * caller — `packages/db` never reads env, and never falls back to a
   * second copy of the number.
   *
   * Required, deliberately: this used to be optional so callers that do
   * not care about changeset grouping were not forced to supply it, and
   * omitting it silently skipped changeset resolution entirely — including
   * for a book-scoped, authored save, which then grouped nothing and said
   * nothing (the book-history e2e seed produced zero changesets this way,
   * caught only by a direct DB query). A caller with no book ancestor and
   * no interest in changesets still supplies a value — `writeRevision()`
   * simply never uses it when `resolveBookId()` finds no book, so
   * threading a harmless positive number costs nothing and closes the
   * silent-skip class entirely rather than trading it for a second
   * "do I need this?" branch at every call site.
   */
  readonly changesetWindowMinutes: number;
}

export interface SavePageResult {
  readonly contentHash: string;
  readonly renderedHtml: string;
  readonly blockIndex: BlockIndex;
  /**
   * `true` when the submitted markdown was byte-identical to the row
   * already stored, so nothing was written: no `page_content` update, no
   * `page_revision`, no changeset activity, no derived rebuild. The
   * revision-history spec pairs a revision with "the corresponding
   * `page_content` change"; a save that changes nothing has no
   * corresponding change and therefore earns no revision. Before this
   * flag existed every such save minted a revision whose diff against
   * its predecessor was empty (docs/TODO.md Findings, 2026-09-17).
   */
  readonly unchanged: boolean;
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
  const tree = parse(canonical);
  const renderedHtml = render(canonical);
  const blockIndex = buildBlockIndex(tree, canonical);

  // Checked before the write transaction opens (design Decision 9 / tasks
  // 3.10-3.13): a trashed page and a nonexistent one are the same absence,
  // and this is the one place that absence is decided for every caller of
  // savePage() — the route's own live_nodes lookup and this one must never
  // be allowed to disagree.
  const [live] = await sql<{ id: string }[]>`
    SELECT id FROM live_nodes WHERE id = ${input.nodeId} AND workspace_id = ${input.workspaceId}
  `;
  if (!live) throw new PageNotFoundError(input.nodeId);

  return sql.begin(async (tx) => {
    let previousMarkdown: string | null = null;

    if (input.expectedContentHash === null) {
      const rows = await tx`
        INSERT INTO page_content (node_id, workspace_id, markdown, rendered_html, block_index, content_hash, pipeline_version, updated_by)
        VALUES (
          ${input.nodeId}, ${input.workspaceId}, ${canonical}, ${renderedHtml},
          ${tx.json(JSON.parse(JSON.stringify(blockIndex)))}, ${contentHash}, ${CURRENT_PIPELINE_VERSION}, ${input.updatedBy ?? null}
        )
        ON CONFLICT (node_id) DO NOTHING
        RETURNING node_id
      `;
      if (rows.length === 0) throw new StaleContentError(input.nodeId);
    } else {
      const [existing] = await tx<{ markdown: string }[]>`
        SELECT markdown FROM page_content
         WHERE node_id = ${input.nodeId} AND workspace_id = ${input.workspaceId}
         FOR UPDATE
      `;
      previousMarkdown = existing?.markdown ?? null;

      // A no-op save: the caller holds the current hash and sends back the
      // very bytes that are stored. Nothing to write — and, deliberately,
      // nothing to record: `updated_by`/`updated_at` keep naming the last
      // real edit, and the author's open changeset is not touched. The
      // stale check still runs first (the `FOR UPDATE` row above is the
      // live one): a byte-identical save against an outdated hash is a
      // stale save, not a no-op, and is refused exactly as before.
      if (previousMarkdown === canonical) {
        if (input.expectedContentHash !== contentHash) throw new StaleContentError(input.nodeId);
        return { contentHash, renderedHtml, blockIndex, unchanged: true };
      }

      const rows = await tx`
        UPDATE page_content
           SET markdown = ${canonical},
               rendered_html = ${renderedHtml},
               block_index = ${tx.json(JSON.parse(JSON.stringify(blockIndex)))},
               content_hash = ${contentHash},
               pipeline_version = ${CURRENT_PIPELINE_VERSION},
               updated_by = ${input.updatedBy ?? null},
               updated_at = now()
         WHERE node_id = ${input.nodeId}
           AND workspace_id = ${input.workspaceId}
           AND content_hash = ${input.expectedContentHash}
        RETURNING node_id
      `;
      if (rows.length === 0) throw new StaleContentError(input.nodeId);
    }

    // Ordered per design.md Decision 3: resolve the owning book, resolve
    // (or open) its changeset, then write the immutable revision snapshot
    // — all before `reconcileDerived`, and all inside this one
    // transaction, so a failure anywhere here rolls back the content
    // write too.
    await writeRevision(tx, {
      nodeId: input.nodeId,
      workspaceId: input.workspaceId,
      content: canonical,
      contentHash,
      blockIndex,
      updatedBy: input.updatedBy,
      changesetWindowMinutes: input.changesetWindowMinutes,
    });

    await reconcileDerived(tx, {
      nodeId: input.nodeId,
      workspaceId: input.workspaceId,
      tree,
      canonicalMarkdown: canonical,
      previousMarkdown,
    });

    return { contentHash, renderedHtml, blockIndex, unchanged: false };
  });
}
