/**
 * The revision half of `savePage()`'s transaction, extracted so the
 * transaction body itself stays readable (task 3.11's REFACTOR, deferred
 * from Phase 3 until `resolveChangeset()` existed — design.md Decision 3's
 * ordering list: resolve the owning book, resolve or open its changeset,
 * then write the immutable revision snapshot).
 */
import type postgres from 'postgres';
import { resolveBookId, resolveChangeset } from '../changesets/resolve-changeset';
import type { BlockIndex } from '@deep-wiki/markdown';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface WriteRevisionInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly blockIndex: BlockIndex;
  readonly updatedBy?: string;
  /** Omitted entirely to skip changeset resolution (see `SavePageInput.changesetWindowMinutes`). */
  readonly changesetWindowMinutes?: number;
}

export interface WriteRevisionResult {
  readonly changesetId: string | null;
}

/**
 * Resolves (or opens) the author's changeset for this save's book, if any,
 * then writes the `page_revision` row. A page with no book ancestor, or a
 * save with no author, simply never joins a changeset — the revision is
 * still written, with `changeset_id = NULL`.
 */
export async function writeRevision(tx: SqlExecutor, input: WriteRevisionInput): Promise<WriteRevisionResult> {
  let changesetId: string | null = null;

  if (input.updatedBy && input.changesetWindowMinutes !== undefined) {
    const bookId = await resolveBookId(tx, { nodeId: input.nodeId, workspaceId: input.workspaceId });
    if (bookId) {
      changesetId = await resolveChangeset(tx, {
        workspaceId: input.workspaceId,
        bookId,
        authorId: input.updatedBy,
        windowMinutes: input.changesetWindowMinutes,
      });
    }
  }

  await tx`
    INSERT INTO page_revision (workspace_id, page_id, author_id, content, content_hash, block_index, changeset_id)
    VALUES (
      ${input.workspaceId}, ${input.nodeId}, ${input.updatedBy ?? null}, ${input.content},
      ${input.contentHash}, ${tx.json(JSON.parse(JSON.stringify(input.blockIndex)))}, ${changesetId}
    )
  `;

  return { changesetId };
}
