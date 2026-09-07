/**
 * Reindexing as an explicit, tracked, resumable job (design.md — "Index
 * generations are rows"; embedding-index-integrity spec — "Reindexing Is
 * an Explicit Tracked Job"). Changing a workspace's embedding model
 * creates a `building` generation and a `queued` job; the active
 * `(embedding_model, dimensions)` pair — and therefore every read filter
 * resolving against it — does not change until the job reaches
 * `completed`, at which point the old generation is retired and the new
 * one activated in a single transaction. No dark window: at any point
 * before that transaction commits, `state = 'active'` still names the
 * prior generation.
 */
import { err, ok, type Result } from '@deep-wiki/core';
import type postgres from 'postgres';

export interface StartReindexInput {
  readonly workspaceId: string;
  readonly toProvider: string;
  readonly toModel: string;
  readonly toDimensions: number;
}

export interface StartedReindex {
  readonly jobId: string;
  readonly buildingGenerationId: string;
  readonly fromModel: string | null;
}

export interface ReindexError {
  readonly reason: string;
}

export async function startReindex(sql: postgres.Sql, input: StartReindexInput): Promise<Result<StartedReindex, ReindexError>> {
  // A failed statement poisons the rest of a Postgres transaction — every
  // statement after it (even the implicit COMMIT) fails too, unless the
  // whole transaction rolls back. The partial-unique-index violation
  // below is therefore caught OUTSIDE `sql.begin()`, not inside it: only
  // a clean rollback of the whole attempt (including the generation row
  // just inserted/updated) is safe to convert into a typed refusal.
  try {
    return await sql.begin(async (tx) => {
      const [active] = await tx<{ embedding_model: string }[]>`
        SELECT embedding_model FROM workspace_embedding_indexes WHERE workspace_id = ${input.workspaceId} AND state = 'active'
      `;

      const [generation] = await tx<{ id: string }[]>`
        INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state)
        VALUES (${input.workspaceId}, ${input.toProvider}, ${input.toModel}, ${input.toDimensions}, 'building')
        ON CONFLICT (workspace_id, embedding_model, dimensions) DO UPDATE SET embedding_provider = excluded.embedding_provider
        RETURNING id
      `;

      const [job] = await tx<{ id: string }[]>`
        INSERT INTO embedding_reindex_jobs (workspace_id, from_model, to_model, state)
        VALUES (${input.workspaceId}, ${active?.embedding_model ?? null}, ${input.toModel}, 'queued')
        RETURNING id
      `;

      return ok({ jobId: job!.id, buildingGenerationId: generation!.id, fromModel: active?.embedding_model ?? null });
    });
  } catch {
    return err({ reason: 'a reindex is already queued or running for this workspace' });
  }
}

/**
 * The one-transaction flip: retire the old active generation, activate
 * the building one, mark the job completed. Idempotent under
 * `WHERE state = 'queued' OR state = 'running'` — completing an
 * already-completed job is a no-op rather than a double activation.
 */
export async function completeReindex(sql: postgres.Sql, jobId: string): Promise<Result<void, ReindexError>> {
  return sql.begin(async (tx) => {
    const [job] = await tx<{ workspace_id: string; to_model: string; state: string }[]>`
      SELECT workspace_id, to_model, state FROM embedding_reindex_jobs WHERE id = ${jobId}
    `;
    if (!job) {
      return err({ reason: `no reindex job with id "${jobId}"` });
    }
    if (job.state !== 'queued' && job.state !== 'running') {
      return ok(undefined);
    }

    await tx`
      UPDATE workspace_embedding_indexes SET state = 'retired'
      WHERE workspace_id = ${job.workspace_id} AND state = 'active'
    `;
    await tx`
      UPDATE workspace_embedding_indexes SET state = 'active', activated_at = now()
      WHERE workspace_id = ${job.workspace_id} AND embedding_model = ${job.to_model} AND state = 'building'
    `;
    await tx`
      UPDATE embedding_reindex_jobs SET state = 'completed', finished_at = now()
      WHERE id = ${jobId}
    `;

    return ok(undefined);
  });
}
